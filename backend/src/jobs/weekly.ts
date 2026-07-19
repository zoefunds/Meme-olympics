/**
 * Weekly competition lifecycle + judging worker.
 *
 * Schedule (UTC):
 *  - Monday 00:05 — rollover: open a new official weekly arena
 *  - exact-time — each competition gets its own setTimeout (armed at
 *    creation, and re-armed for all open arenas on process startup) that
 *    fires its close the instant endsAt hits, independent of any other
 *    arena's judging load.
 *  - every minute — deadline sweep: a fallback safety net that catches
 *    any arena whose timer was lost (e.g. a deploy restarted the process
 *    between scheduling and firing); also drives judging + finalization.
 *
 * All chain calls are operator-signed and idempotent against contract state.
 */
import cron from "node-cron";
import { prisma } from "../lib/prisma";
import * as gl from "../services/genlayer";
import { logger } from "../lib/logger";
import { sendEvaluationEmail, sendWinnerEmail } from "../services/email";

function isoWeekId(date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `week-${d.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

/**
 * Close a single competition (idempotent — a no-op if it's already past
 * 'open'). Shared by the exact-time timer (fires the instant a deadline
 * hits) and the per-minute sweep (a safety net for timers lost to a
 * restart/deploy between scheduling and firing).
 */
async function closeCompetition(id: string) {
  const comp = await prisma.competition.findUnique({ where: { id } });
  if (!comp || comp.status !== "open") return;
  await prisma.competition.update({ where: { id }, data: { status: "judging" } });
  if (gl.isChainConfigured() && comp.onchainCreated) {
    try {
      await gl.closeSubmissionsOnChain(id);
    } catch (err) {
      logger.error({ comp: id, err: (err as Error).message }, "close_submissions failed");
    }
  }
  logger.info({ comp: id }, "competition closed at deadline");
}

/**
 * Close any 'open' competition whose deadline has passed. This is now the
 * fallback path — the common case is the exact-time timer in
 * scheduleClose() firing the instant a deadline hits. This sweep only
 * catches arenas whose timer was lost (e.g. a deploy restarted the
 * process between scheduling and firing).
 */
export async function runDeadlineClose() {
  const now = new Date();
  const expired = await prisma.competition.findMany({
    where: { status: "open", endsAt: { lte: now } },
  });
  for (const comp of expired) {
    await closeCompetition(comp.id);
  }
  return { closed: expired.map((c) => c.id) };
}

// setTimeout's delay is a signed 32-bit int (~24.8 days max) — clamp and
// re-arm in chunks so multi-day arena deadlines don't overflow into an
// immediate fire.
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const closeTimers = new Map<string, NodeJS.Timeout>();

/**
 * Arm an exact-time timer for a single competition's deadline, so its
 * close fires the instant endsAt hits rather than waiting on the next
 * minute-sweep tick. Safe to call multiple times for the same id (the
 * previous timer is replaced).
 */
export function scheduleClose(id: string, endsAt: Date) {
  const existing = closeTimers.get(id);
  if (existing) clearTimeout(existing);

  const fire = () => {
    closeTimers.delete(id);
    void closeCompetition(id);
  };

  const delay = endsAt.getTime() - Date.now();
  if (delay <= 0) {
    fire();
    return;
  }
  if (delay > MAX_TIMEOUT_MS) {
    // Too far out for one setTimeout — check back in before the cap and
    // re-arm with the remaining delay.
    closeTimers.set(
      id,
      setTimeout(() => scheduleClose(id, endsAt), MAX_TIMEOUT_MS)
    );
    return;
  }
  closeTimers.set(id, setTimeout(fire, delay));
}

/**
 * On process startup, re-arm exact-time timers for every currently-open
 * competition — in-memory timers don't survive a restart/deploy, so this
 * is what keeps deadlines exact across deploys instead of silently
 * falling back to sweep-only (up to 1 minute) precision.
 */
export async function armPendingCloseTimers() {
  const open = await prisma.competition.findMany({ where: { status: "open" } });
  for (const comp of open) {
    scheduleClose(comp.id, comp.endsAt);
  }
  logger.info({ count: open.length }, "armed exact-time close timers");
}

export async function runWeeklyRollover() {
  const newId = isoWeekId();
  const now = new Date();
  const endsAt = new Date(now);
  endsAt.setUTCDate(endsAt.getUTCDate() + ((8 - endsAt.getUTCDay()) % 7 || 7));
  endsAt.setUTCHours(0, 0, 0, 0);

  // Create/open this week's competition. Closing expired arenas (including
  // last week's) is handled continuously by runDeadlineClose, not here.
  let comp = await prisma.competition.findUnique({ where: { id: newId } });
  if (!comp) {
    comp = await prisma.competition.create({
      data: {
        id: newId,
        title: `Meme Olympics ${newId.replace("week-", "Week ")}`,
        theme: "Current crypto culture — this week's market, narratives and lore",
        status: "open",
        startsAt: now,
        endsAt,
      },
    });
    if (gl.isChainConfigured()) {
      try {
        await gl.createCompetitionOnChain(
          newId,
          comp.title,
          comp.theme,
          now.toISOString(),
          endsAt.toISOString()
        );
        await gl.openCompetitionOnChain(newId);
        await prisma.competition.update({
          where: { id: newId },
          data: { onchainCreated: true },
        });
      } catch (err) {
        logger.error({ err: (err as Error).message }, "on-chain rollover failed");
      }
    }
    scheduleClose(newId, endsAt);
  }
  logger.info({ competition: newId }, "weekly rollover complete");
  return { opened: newId };
}

/** Evaluate on-chain submissions that haven't been judged yet, then sync results.
 * Only judges submissions whose competition has actually CLOSED (status
 * 'judging') — a competition still 'open' (deadline not reached) must never
 * have its entries evaluated early, even if they're already registered
 * on-chain. Closing happens in runDeadlineClose once the deadline passes. */
export async function runJudgingSweep() {
  if (!gl.isChainConfigured()) return { evaluated: 0, note: "chain not configured" };

  const pending = await prisma.submission.findMany({
    where: {
      status: { in: ["pending", "onchain"] },
      competition: { status: "judging" },
    },
    orderBy: { createdAt: "desc" }, // newest first — stale rows can't starve the batch
    take: 10, // bounded batch: judging is LLM-heavy on-chain
    include: { user: true },
  });

  let evaluated = 0;
  for (const sub of pending) {
    try {
      // READ-BEFORE-ACT: never send a duplicate evaluate transaction.
      // Only a genuinely un-judged on-chain submission gets an evaluate tx;
      // anything already processed is synced without touching the chain.
      let state = (await gl.getOnchainSubmission(sub.id)) as { status: string };
      if (state.status === "pending") {
        await gl.evaluateSubmissionOnChain(sub.id);
        // Poll until the settled state is readable (accepted tx state can
        // lag reads) so we never write a stale "pending" back to the DB.
        for (let i = 0; i < 12; i++) {
          state = (await gl.getOnchainSubmission(sub.id)) as { status: string };
          if (state.status !== "pending") break;
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
      if (state.status === "pending") continue; // still settling — next sweep
      const onchain = state as {
        status: string;
        total_score: number;
        criteria: Record<string, number>;
        plagiarism_verdict: string;
        plagiarism_confidence: number;
        evaluation_summary: string;
      };
      await prisma.submission.update({
        where: { id: sub.id },
        data: {
          status: onchain.status,
          totalScore: Number(onchain.total_score || 0),
          criteriaJson: JSON.stringify(onchain.criteria || {}),
          plagiarismVerdict: String(onchain.plagiarism_verdict || ""),
          plagiarismConfidence: Number(onchain.plagiarism_confidence || 0),
          evaluationSummary: String(onchain.evaluation_summary || ""),
        },
      });
      evaluated++;
      sendEvaluationEmail(
        sub.userId,
        sub.user.email,
        sub.title,
        Number(onchain.total_score || 0),
        String(onchain.plagiarism_verdict || ""),
        String(onchain.evaluation_summary || "")
      ).catch(() => undefined);
    } catch (err) {
      const msg = (err as Error).message || "";
      // A row that never landed on-chain can't ever be judged — after 30
      // minutes mark it failed instead of retrying forever.
      if (
        /Submission not found/.test(msg) &&
        Date.now() - sub.createdAt.getTime() > 30 * 60 * 1000
      ) {
        await prisma.submission.update({
          where: { id: sub.id },
          data: { status: "failed" },
        });
        logger.warn({ sub: sub.id }, "marked failed: never registered on-chain");
        continue;
      }
      logger.error({ sub: sub.id, err: msg }, "evaluation failed; will retry next sweep");
    }
  }
  return { evaluated };
}

/** Finalize competitions stuck in judging whose submissions are all processed. */
export async function runFinalization() {
  if (!gl.isChainConfigured()) return { finalized: [] as string[] };
  const judging = await prisma.competition.findMany({ where: { status: "judging" } });
  const finalized: string[] = [];

  for (const comp of judging) {
    const unprocessed = await prisma.submission.count({
      where: { competitionId: comp.id, status: { in: ["pending", "onchain"] } },
    });
    if (unprocessed > 0) continue;

    try {
      await gl.finalizeCompetitionOnChain(comp.id, new Date().toISOString());
      // Same accepted-but-not-yet-readable lag we've hit elsewhere: a read
      // immediately after the finalize write can still return pre-finalize
      // (empty winners) state. Poll until the read itself reflects the
      // write before caching it — never trust the first read after a write.
      const onchain = await gl.readSettled<{
        status: string;
        winners: Array<{
          submission_id: string;
          rank: number;
          reward_atto: string;
        }>;
      }>(
        "get_competition",
        [comp.id],
        (v) => v.status === "finalized" && Array.isArray(v.winners)
      );
      const winners = onchain.status === "finalized" ? onchain.winners || [] : [];
      if (onchain.status !== "finalized") {
        logger.warn(
          { comp: comp.id },
          "finalize read did not settle in time; will retry next sweep"
        );
        continue;
      }
      await prisma.competition.update({
        where: { id: comp.id },
        data: {
          status: "finalized",
          onchainFinalized: true,
          winnersJson: JSON.stringify(winners),
        },
      });
      for (const w of winners) {
        const sub = await prisma.submission.update({
          where: { id: w.submission_id },
          data: { status: "winner" },
          include: { user: true },
        });
        const points = (BigInt(w.reward_atto) / BigInt(10 ** 18)).toString();
        sendWinnerEmail(sub.userId, sub.user.email, sub.title, w.rank, points).catch(
          () => undefined
        );
      }
      finalized.push(comp.id);
    } catch (err) {
      logger.error(
        { comp: comp.id, err: (err as Error).message },
        "finalization failed; will retry"
      );
    }
  }
  return { finalized };
}

let closeRunning = false;
let judgeRunning = false;

/**
 * Deadline close on its own guard, separate from judging/finalization.
 * Closing is just a status flip + one fast on-chain call — it must never
 * be blocked by another competition's judging run, which can legitimately
 * take hours under strict sequential evaluation. Without this separation,
 * an arena whose deadline has passed could keep accepting submissions for
 * as long as an unrelated arena's judging sweep was still in flight.
 */
async function runCloseTick() {
  if (closeRunning) return;
  closeRunning = true;
  try {
    await runDeadlineClose();
  } catch (err) {
    logger.error({ err: (err as Error).message }, "deadline close tick failed");
  } finally {
    closeRunning = false;
  }
}

/**
 * Judging + finalization on their own guard — kept single-flight so only
 * one competition's submissions are ever being judged at a time (strict
 * sequential judging), independent of how often closes are ticking.
 */
async function runJudgeTick() {
  if (judgeRunning) return;
  judgeRunning = true;
  try {
    await runJudgingSweep();
    await runFinalization();
  } catch (err) {
    logger.error({ err: (err as Error).message }, "judging tick failed");
  } finally {
    judgeRunning = false;
  }
}

export function startSchedulers() {
  // Weekly rollover — Mondays 00:05 UTC (opens the new official arena only)
  cron.schedule("5 0 * * 1", () => void runWeeklyRollover(), { timezone: "UTC" });
  // Close sweep — every minute, always runs: flips any expired 'open'
  // competition to 'judging' immediately, regardless of judging load.
  cron.schedule("* * * * *", () => void runCloseTick(), { timezone: "UTC" });
  // Judging sweep — every minute, single-flight: judges/finalizes whatever
  // is already closed, one competition's submissions at a time.
  cron.schedule("* * * * *", () => void runJudgeTick(), { timezone: "UTC" });
  logger.info("schedulers started (weekly rollover, per-minute close + judge sweeps)");
}
