/**
 * Weekly competition lifecycle + judging worker.
 *
 * Schedule (UTC):
 *  - Monday 00:05  — rollover: close last week (judging), open new week
 *  - hourly        — judging sweep: evaluate on-chain pending submissions
 *  - Monday 12:05  — finalize previous week after judging, email winners
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

export async function runWeeklyRollover() {
  const newId = isoWeekId();
  const now = new Date();
  const endsAt = new Date(now);
  endsAt.setUTCDate(endsAt.getUTCDate() + ((8 - endsAt.getUTCDay()) % 7 || 7));
  endsAt.setUTCHours(0, 0, 0, 0);

  // Move any open competition into judging.
  const open = await prisma.competition.findMany({ where: { status: "open" } });
  for (const comp of open) {
    if (comp.id === newId) continue;
    await prisma.competition.update({
      where: { id: comp.id },
      data: { status: "judging" },
    });
    if (gl.isChainConfigured() && comp.onchainCreated) {
      try {
        await gl.closeSubmissionsOnChain(comp.id);
      } catch (err) {
        logger.error({ err: (err as Error).message }, "close_submissions failed");
      }
    }
  }

  // Create/open this week's competition.
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
  return { opened: newId, closed: open.map((c) => c.id) };
}

/** Evaluate on-chain submissions that haven't been judged yet, then sync results. */
export async function runJudgingSweep() {
  if (!gl.isChainConfigured()) return { evaluated: 0, note: "chain not configured" };

  const pending = await prisma.submission.findMany({
    where: { status: "onchain" },
    take: 10, // bounded batch: judging is LLM-heavy on-chain
    include: { user: true },
  });

  let evaluated = 0;
  for (const sub of pending) {
    try {
      await gl.evaluateSubmissionOnChain(sub.id);
      const onchain = (await gl.getOnchainSubmission(sub.id)) as {
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
      logger.error(
        { sub: sub.id, err: (err as Error).message },
        "evaluation failed; will retry next sweep"
      );
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
      const onchain = (await gl.getOnchainCompetition(comp.id)) as {
        winners: Array<{
          submission_id: string;
          rank: number;
          reward_atto: string;
        }>;
      };
      const winners = onchain.winners || [];
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

export function startSchedulers() {
  // Weekly rollover — Mondays 00:05 UTC
  cron.schedule("5 0 * * 1", () => void runWeeklyRollover(), { timezone: "UTC" });
  // Judging sweep — hourly at :15
  cron.schedule("15 * * * *", () => void runJudgingSweep(), { timezone: "UTC" });
  // Finalization attempt — hourly at :45
  cron.schedule("45 * * * *", () => void runFinalization(), { timezone: "UTC" });
  logger.info("schedulers started (rollover, judging, finalization)");
}
