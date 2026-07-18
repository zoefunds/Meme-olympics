/**
 * Weekly competition lifecycle + judging worker.
 *
 * Schedule (UTC):
 *  - Monday 00:05 — rollover: open a new official weekly arena
 *  - every minute — deadline sweep: close any arena whose deadline just
 *    passed, judge its submissions, and finalize once judging is complete —
 *    all in the same tick, so the full pipeline runs within ~1 minute of
 *    the deadline instead of waiting on a hard-coded hourly schedule.
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
 * Close any 'open' competition whose deadline has passed, moving it into
 * judging both in the DB and on-chain. Runs every minute so a deadline is
 * acted on almost immediately rather than waiting on an hourly tick.
 */
export async function runDeadlineClose() {
  const now = new Date();
  const expired = await prisma.competition.findMany({
    where: { status: "open", endsAt: { lte: now } },
  });
  for (const comp of expired) {
    await prisma.competition.update({
      where: { id: comp.id },
      data: { status: "judging" },
    });
    if (gl.isChainConfigured() && comp.onchainCreated) {
      try {
        await gl.closeSubmissionsOnChain(comp.id);
      } catch (err) {
        logger.error(
          { comp: comp.id, err: (err as Error).message },
          "close_submissions failed"
        );
      }
    }
    logger.info({ comp: comp.id }, "competition closed at deadline");
  }
  return { closed: expired.map((c) => c.id) };
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

let sweepRunning = false;

/**
 * The full per-competition pipeline in one tick: close arenas whose
 * deadline just passed, judge whatever's pending, finalize whatever's
 * fully judged. Guarded against overlap — judging a handful of submissions
 * can take longer than the 1-minute tick, so a slow run skips the next
 * tick rather than piling up concurrent sweeps.
 */
async function runDeadlineSweep() {
  if (sweepRunning) return;
  sweepRunning = true;
  try {
    await runDeadlineClose();
    await runJudgingSweep();
    await runFinalization();
  } catch (err) {
    logger.error({ err: (err as Error).message }, "deadline sweep failed");
  } finally {
    sweepRunning = false;
  }
}

export function startSchedulers() {
  // Weekly rollover — Mondays 00:05 UTC (opens the new official arena only)
  cron.schedule("5 0 * * 1", () => void runWeeklyRollover(), { timezone: "UTC" });
  // Deadline sweep — every minute: close expired arenas, judge, finalize.
  // This is what makes judging happen immediately after a deadline instead
  // of on a fixed hourly schedule.
  cron.schedule("* * * * *", () => void runDeadlineSweep(), { timezone: "UTC" });
  logger.info("schedulers started (weekly rollover, per-minute deadline sweep)");
}
