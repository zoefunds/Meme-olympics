import { Router, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireAdmin, AuthedRequest } from "../middleware/auth";
import * as gl from "../services/genlayer";
import { runWeeklyRollover, runJudgingSweep } from "../jobs/weekly";

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
    await gl.createCompetitionOnChain(d.id, d.title, d.theme, d.startsAt, d.endsAt);
    if (d.open) await gl.openCompetitionOnChain(d.id);
    await prisma.competition.update({
      where: { id: d.id },
      data: { onchainCreated: true },
    });
  }
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

// POST /api/admin/resolve-dispute/:id
adminRouter.post("/resolve-dispute/:id", async (req, res: Response) => {
  if (!gl.isChainConfigured()) {
    return res.status(503).json({ error: "Contract not configured" });
  }
  await gl.resolveDisputeOnChain(req.params.id, new Date().toISOString());
  const onchain = (await gl.readContract("get_dispute", [req.params.id])) as {
    status?: string;
    verdict_summary?: string;
  };
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
