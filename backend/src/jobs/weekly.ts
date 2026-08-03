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
import * as escrow from "../services/baseSepolia";
import { logger } from "../lib/logger";
import { withLock } from "../lib/redis";

function isoWeekId(date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `week-${d.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

function isMissingOnchainCompetition(err: unknown): boolean {
  return /Competition not found/i.test((err as Error).message || "");
}

function isMissingOnchainCompetitionRead(err: unknown): boolean {
  return /Competition not found|execution failed|unknown RPC error/i.test(
    (err as Error).message || ""
  );
}

async function markCompetitionDetachedFromChain(id: string) {
  await prisma.competition.update({
    where: { id },
    data: { onchainCreated: false, onchainFinalized: false },
  });
  logger.warn(
    { comp: id },
    "competition does not exist on current contract; detached from on-chain lifecycle"
  );
}

/**
 * Close a single competition (idempotent — a no-op if it's already past
 * 'open'). Shared by the exact-time timer (fires the instant a deadline
 * hits) and the per-minute sweep (a safety net for timers lost to a
 * restart/deploy between scheduling and firing).
 */
async function closeCompetition(id: string) {
  const now = new Date();
  const comp = await prisma.competition.findUnique({ where: { id } });
  if (!comp || comp.status !== "open" || comp.endsAt > now) return;
  if (gl.isChainConfigured()) {
    // A competition that never confirmed on-chain has nothing to close and
    // must NOT be allowed to progress to 'judging' — judging/finalization
    // both require onchainCreated=true, so flipping status here regardless
    // would create an arena stuck in judging forever with no path to
    // finalize. Leave it open; retryOnchainCreationSweep() will keep
    // attempting the on-chain creation on every tick until it lands (or an
    // operator intervenes) before this can ever close.
    if (!comp.onchainCreated) {
      logger.error(
        { comp: id },
        "cannot close: competition never confirmed on-chain; leaving open for reconciliation"
      );
      return;
    }
    try {
      await gl.closeSubmissionsOnChain(id);
    } catch (err) {
      if (isMissingOnchainCompetition(err)) {
        await markCompetitionDetachedFromChain(id);
        return;
      }
      logger.error({ comp: id, err: (err as Error).message }, "close_submissions failed");
      return;
    }
  }
  await prisma.competition.update({ where: { id }, data: { status: "judging" } });
  logger.info({ comp: id }, "competition closed at deadline");
}

/**
 * Retry on-chain creation for any 'open' competition that never confirmed
 * on-chain (onchainCreated=false) — reachable only via system-created
 * arenas (weekly rollover) or a contract switch reconciliation, since
 * user-hosted creation now rolls back its DB row on failure instead of
 * leaving one behind. Runs every close tick so a transient RPC failure at
 * creation time self-heals well before the deadline arrives.
 */
export async function retryOnchainCreationSweep() {
  if (!gl.isChainConfigured()) return { retried: [] as string[] };
  const stuck = await prisma.competition.findMany({
    where: { status: "open", onchainCreated: false },
  });
  const retried: string[] = [];
  for (const comp of stuck) {
    try {
      await gl.createCompetitionOnChain(
        comp.id,
        comp.title,
        comp.theme,
        comp.startsAt.toISOString(),
        comp.endsAt.toISOString()
      );
      await gl.openCompetitionOnChain(comp.id);
      await prisma.competition.update({
        where: { id: comp.id },
        data: { onchainCreated: true },
      });
      scheduleClose(comp.id, comp.endsAt);
      retried.push(comp.id);
      logger.info({ comp: comp.id }, "on-chain creation retry succeeded");
    } catch (err) {
      logger.warn(
        { comp: comp.id, err: (err as Error).message },
        "on-chain creation retry failed; will retry next tick"
      );
    }
  }
  return { retried };
}

// NOTE: submission and dispute on-chain registration are signed by the
// user's own connected wallet from the frontend now (lib/genlayer.ts) —
// this backend holds no user private keys, so it can no longer retry those
// writes server-side the way it retries operator-signed ones above. A
// submission/dispute that never got its frontend-signed tx confirmed just
// stays 'pending'/onchainOpened=false; the user can resubmit that action
// from the UI.

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
  }

  if (gl.isChainConfigured()) {
    let existsOnCurrentContract = false;
    try {
      const onchain = (await gl.getOnchainCompetition(newId)) as { status: string };
      existsOnCurrentContract = true;
      if (onchain.status === "created") {
        await gl.openCompetitionOnChain(newId);
      }
      if (!comp.onchainCreated) {
        await prisma.competition.update({
          where: { id: newId },
          data: { onchainCreated: true },
        });
      }
    } catch (err) {
      if (isMissingOnchainCompetitionRead(err)) {
        if (comp.onchainCreated) {
          await markCompetitionDetachedFromChain(newId);
        }
      } else {
        logger.warn(
          { competition: newId, err: (err as Error).message },
          "could not verify weekly competition on current contract"
        );
      }
    }

    if (!existsOnCurrentContract && comp.status === "open" && comp.endsAt > now) {
      try {
        await gl.createCompetitionOnChain(
          newId,
          comp.title,
          comp.theme,
          comp.startsAt.toISOString(),
          comp.endsAt.toISOString()
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

  if (comp.status === "open") {
    scheduleClose(newId, comp.endsAt);
  }

  logger.info({ competition: newId }, "weekly rollover complete");
  return { opened: newId };
}

async function ensureCompetitionExistsOnCurrentContract(id: string): Promise<boolean> {
  try {
    await gl.getOnchainCompetition(id);
    return true;
  } catch (err) {
    if (isMissingOnchainCompetitionRead(err)) {
      await markCompetitionDetachedFromChain(id);
      return false;
    }
    throw err;
  }
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
      competition: {
        status: "judging",
        endsAt: { lte: new Date() },
        onchainCreated: true,
      },
    },
    orderBy: { createdAt: "desc" }, // newest first — stale rows can't starve the batch
    take: 10, // bounded batch: judging is LLM-heavy on-chain
    include: { user: true },
  });

  let evaluated = 0;
  for (const sub of pending) {
    try {
      const exists = await ensureCompetitionExistsOnCurrentContract(sub.competitionId);
      if (!exists) continue;
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
  const judging = await prisma.competition.findMany({
    where: { status: "judging", endsAt: { lte: new Date() }, onchainCreated: true },
  });
  const finalized: string[] = [];

  for (const comp of judging) {
    const unprocessed = await prisma.submission.count({
      where: { competitionId: comp.id, status: { in: ["pending", "onchain"] } },
    });
    if (unprocessed > 0) continue;

    try {
      let onchainBefore: { status: string };
      try {
        onchainBefore = (await gl.getOnchainCompetition(comp.id)) as {
          status: string;
        };
      } catch (err) {
        if (isMissingOnchainCompetitionRead(err)) {
          await markCompetitionDetachedFromChain(comp.id);
          continue;
        }
        throw err;
      }
      if (onchainBefore.status === "open") {
        await gl.closeSubmissionsOnChain(comp.id);
        logger.info(
          { comp: comp.id },
          "repaired stale local judging state by closing on-chain competition"
        );
        continue;
      }
      if (onchainBefore.status !== "judging") {
        logger.warn(
          { comp: comp.id, onchainStatus: onchainBefore.status },
          "skipping finalization because on-chain competition is not judging"
        );
        continue;
      }
      await gl.finalizeCompetitionOnChain(comp.id, new Date().toISOString());
      // Same accepted-but-not-yet-readable lag we've hit elsewhere: a read
      // immediately after the finalize write can still return pre-finalize
      // (empty winners) state. Poll until the read itself reflects the
      // write before caching it — never trust the first read after a write.
      const onchain = await gl.readSettled<{
        status: string;
        winners: Array<{
          submission_id: string;
          author: string;
          rank: number;
          score: number;
          reward_usdc: string;
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
        await prisma.submission.update({
          where: { id: w.submission_id },
          data: { status: "winner" },
        });
      }
      finalized.push(comp.id);
      await relayPrizesToEscrow(comp.id, winners).catch((err) =>
        logger.warn(
          { comp: comp.id, err: (err as Error).message },
          "prize relay to Base Sepolia failed; runPrizeRelaySweep will retry"
        )
      );
    } catch (err) {
      if (isMissingOnchainCompetition(err)) {
        await markCompetitionDetachedFromChain(comp.id);
        continue;
      }
      logger.error(
        { comp: comp.id, err: (err as Error).message },
        "finalization failed; will retry"
      );
    }
  }
  return { finalized };
}

/**
 * Push one finalized competition's winners onto the Base Sepolia escrow
 * (real, claimable USDC) and record the relay on GenLayer so it's never
 * attempted twice. A no-op if the escrow isn't configured yet, if there's
 * nothing to pay out, or if GenLayer already has a relay_tx_hash recorded
 * for this competition (idempotency check before the possibly-costly
 * on-chain call).
 */
async function relayPrizesToEscrow(
  competitionId: string,
  winners: Array<{
    submission_id: string;
    author: string;
    rank: number;
    score: number;
    reward_usdc: string;
  }>
): Promise<void> {
  if (!escrow.isEscrowConfigured()) return;
  const hasReward = winners.some((w) => BigInt(w.reward_usdc || "0") > BigInt(0));
  if (!hasReward) return;

  const onchainComp = (await gl.getOnchainCompetition(competitionId)) as {
    relay_tx_hash?: string;
  };
  if (onchainComp.relay_tx_hash) {
    // Already relayed on GenLayer — just make sure our own mirror agrees
    // (e.g. after a restart between the on-chain mark and this DB write).
    await prisma.competition
      .update({ where: { id: competitionId }, data: { relayTxHash: onchainComp.relay_tx_hash } })
      .catch(() => undefined);
    return;
  }

  // `winners[].author` is now the winner's actual connected wallet — every
  // GenLayer write is signed directly by that wallet (see
  // frontend/src/lib/genlayer.ts), so no address translation is needed
  // before crediting the escrow.
  const txHash = await escrow.relayWinnersToEscrow(competitionId, winners);
  await gl.markPrizesRelayedOnChain(competitionId, txHash);
  await prisma.competition.update({ where: { id: competitionId }, data: { relayTxHash: txHash } });
  logger.info({ comp: competitionId, txHash }, "prizes relayed to Base Sepolia escrow");
}

/**
 * Retry relay for any finalized competition GenLayer doesn't yet show a
 * relay_tx_hash for. Catches the case where relayPrizesToEscrow's inline
 * attempt (right after finalize) failed transiently — e.g. Base Sepolia RPC
 * hiccup — without blocking finalization itself on that failure.
 */
export async function runPrizeRelaySweep() {
  if (!gl.isChainConfigured() || !escrow.isEscrowConfigured()) {
    return { relayed: [] as string[] };
  }
  const candidates = await prisma.competition.findMany({
    where: { status: "finalized", onchainFinalized: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const relayed: string[] = [];
  for (const comp of candidates) {
    try {
      const winners = JSON.parse(comp.winnersJson || "[]") as Array<{
        submission_id: string;
        author: string;
        rank: number;
        score: number;
        reward_usdc: string;
      }>;
      if (winners.length === 0) continue;
      const onchainComp = (await gl.getOnchainCompetition(comp.id)) as {
        relay_tx_hash?: string;
      };
      if (onchainComp.relay_tx_hash) continue; // already relayed
      await relayPrizesToEscrow(comp.id, winners);
      relayed.push(comp.id);
    } catch (err) {
      logger.warn(
        { comp: comp.id, err: (err as Error).message },
        "prize relay retry failed; will retry next sweep"
      );
    }
  }
  return { relayed };
}

let closeRunning = false;
let judgeRunning = false;
let relayRunning = false;

/**
 * Deadline close on its own guard, separate from judging/finalization.
 * Closing is just a status flip + one fast on-chain call — it must never
 * be blocked by another competition's judging run, which can legitimately
 * take hours under strict sequential evaluation. Without this separation,
 * an arena whose deadline has passed could keep accepting submissions for
 * as long as an unrelated arena's judging sweep was still in flight.
 */
// Cross-machine locks: this app intentionally runs multiple Fly machines
// for 24/7 uptime, and each one fires the exact same cron schedule
// independently — without a lock, every tick runs once PER MACHINE
// (double close/evaluate/finalize/relay calls). See lib/redis.ts's
// withLock docs. `closeRunning`/`judgeRunning`/`relayRunning` remain as a
// same-process fast-path so a machine doesn't even attempt Redis when it's
// already mid-tick itself.
async function runCloseTick() {
  if (closeRunning) return;
  closeRunning = true;
  try {
    await withLock("close-tick", 55_000, runDeadlineClose);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "deadline close tick failed");
  } finally {
    closeRunning = false;
  }
}

/**
 * Judging + finalization on their own guard — kept single-flight so only
 * one competition's submissions are ever being judged at a time (strict
 * sequential judging), independent of how often closes are ticking. The
 * lock TTL is long (and renewed while running) because a single tick can
 * legitimately take minutes: each submission's evaluate call waits for
 * on-chain FINALIZED before the next one is even broadcast.
 */
async function runJudgeTick() {
  if (judgeRunning) return;
  judgeRunning = true;
  try {
    await withLock("judge-tick", 10 * 60_000, async () => {
      await runJudgingSweep();
      await runFinalization();
    });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "judging tick failed");
  } finally {
    judgeRunning = false;
  }
}

/**
 * Prize relay on its own guard, separate from judging/finalization — a slow
 * or stuck Base Sepolia RPC must never hold up judging or closing arenas.
 */
async function runRelayTick() {
  if (relayRunning) return;
  relayRunning = true;
  try {
    await withLock("relay-tick", 2 * 60_000, runPrizeRelaySweep);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "prize relay tick failed");
  } finally {
    relayRunning = false;
  }
}

export function startSchedulers() {
  // Weekly rollover — Mondays 00:05 UTC (opens the new official arena only).
  // Locked too: without it, every machine would try to create the same
  // week's arena at once.
  cron.schedule("5 0 * * 1", () => void withLock("weekly-rollover", 5 * 60_000, runWeeklyRollover), {
    timezone: "UTC",
  });
  // Close sweep — every minute, always runs: flips any expired 'open'
  // competition to 'judging' immediately, regardless of judging load.
  cron.schedule("* * * * *", () => void runCloseTick(), { timezone: "UTC" });
  // Judging sweep — every minute, single-flight: judges/finalizes whatever
  // is already closed, one competition's submissions at a time.
  cron.schedule("* * * * *", () => void runJudgeTick(), { timezone: "UTC" });
  // Prize relay sweep — every 2 minutes: catches any finalized competition
  // whose Base Sepolia relay didn't land inline at finalize time.
  cron.schedule("*/2 * * * *", () => void runRelayTick(), { timezone: "UTC" });
  logger.info(
    "schedulers started (weekly rollover, per-minute close + judge sweeps, prize relay sweep)"
  );
}
