import { Router, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireAdmin, AuthedRequest } from "../middleware/auth";
import * as gl from "../services/genlayer";
import { runWeeklyRollover, runJudgingSweep, scheduleClose } from "../jobs/weekly";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

// GET /api/admin/overview
adminRouter.get("/overview", async (_req, res: Response) => {
  const [users, submissions, competitions, disputes] = await Promise.all([
    prisma.user.count(),
    prisma.submission.count(),
    prisma.competition.count(),
    prisma.dispute.count(),
  ]);
  let contractInfo: unknown = null;
  if (gl.isChainConfigured()) {
    try {
      contractInfo = await gl.getContractInfo();
    } catch {
      /* best effort */
    }
  }
  return res.json({
    users,
    submissions,
    competitions,
    disputes,
    chainConfigured: gl.isChainConfigured(),
    contractInfo,
  });
});

// POST /api/admin/competitions — create + open a competition now
adminRouter.post("/competitions", async (req: AuthedRequest, res: Response) => {
  const schema = z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9\-]{2,63}$/),
    title: z.string().min(1).max(120),
    theme: z.string().max(600).default(""),
    startsAt: z.string(),
    endsAt: z.string(),
    open: z.boolean().default(true),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const d = parsed.data;
  const comp = await prisma.competition.create({
    data: {
      id: d.id,
      title: d.title,
      theme: d.theme,
      status: d.open ? "open" : "created",
      startsAt: new Date(d.startsAt),
      endsAt: new Date(d.endsAt),
    },
  });

  if (gl.isChainConfigured()) {
    try {
      await gl.createCompetitionOnChain(d.id, d.title, d.theme, d.startsAt, d.endsAt);
      if (d.open) await gl.openCompetitionOnChain(d.id);
      await prisma.competition.update({
        where: { id: d.id },
        data: { onchainCreated: true },
      });
    } catch (err) {
      // Same rule as the user-hosted creation path: a row that never
      // confirmed on-chain must not be left dangling as a live "open"
      // arena — judging/finalization both require onchainCreated=true, so
      // an unconfirmed row here has no path to close/finalize.
      await prisma.competition.delete({ where: { id: d.id } }).catch(() => undefined);
      return res.status(502).json({
        error: "On-chain competition creation failed; not created. " + (err as Error).message,
      });
    }
  }
  if (d.open) scheduleClose(d.id, comp.endsAt);
  return res.status(201).json({ competition: comp });
});

// POST /api/admin/rollover — manually trigger the weekly rollover
adminRouter.post("/rollover", async (_req, res: Response) => {
  const result = await runWeeklyRollover();
  return res.json(result);
});

// POST /api/admin/judge-sweep — evaluate pending on-chain submissions
adminRouter.post("/judge-sweep", async (_req, res: Response) => {
  const result = await runJudgingSweep();
  return res.json(result);
});

// POST /api/admin/mark-failed — maintenance: flag submissions the judging
// sweep can never process (e.g. registered against a previous contract
// deployment) so they stop being retried. Scoped by competition ids.
adminRouter.post("/mark-failed", async (req, res: Response) => {
  const schema = z.object({ competitionIds: z.array(z.string()).min(1).max(20) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const result = await prisma.submission.updateMany({
    where: {
      status: { in: ["pending", "onchain"] },
      competitionId: { in: parsed.data.competitionIds },
    },
    data: { status: "failed" },
  });
  return res.json({ markedFailed: result.count });
});

// POST /api/admin/resolve-dispute/:id
adminRouter.post("/resolve-dispute/:id", async (req, res: Response) => {
  if (!gl.isChainConfigured()) {
    return res.status(503).json({ error: "Contract not configured" });
  }
  await gl.resolveDisputeOnChain(req.params.id, new Date().toISOString());
  // Same read-after-write lag every other onchain-confirm route guards
  // against — a read immediately after this write can still miss.
  const onchain = await gl.readUntilFound<{ status?: string; verdict_summary?: string }>(
    "get_dispute",
    [req.params.id],
    (v) => Boolean(v?.status)
  );
  const dispute = await prisma.dispute.update({
    where: { id: req.params.id },
    data: {
      status: String(onchain?.status || "rejected"),
      verdict: String(onchain?.verdict_summary || ""),
      resolvedAt: new Date(),
    },
  });
  return res.json({ dispute });
});
