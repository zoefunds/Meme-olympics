import { Router } from "express";
import { prisma } from "../lib/prisma";
import { cacheGet, cacheSet } from "../lib/redis";
import * as gl from "../services/genlayer";

export const competitionsRouter = Router();

// GET /api/competitions — list (cached 120s)
competitionsRouter.get("/", async (_req, res) => {
  const cached = await cacheGet("comps:list");
  if (cached) return res.json(JSON.parse(cached));
  const comps = await prisma.competition.findMany({
    orderBy: { startsAt: "desc" },
    take: 20,
    include: { _count: { select: { submissions: true } } },
  });
  const payload = {
    competitions: comps.map((c) => ({
      id: c.id,
      title: c.title,
      theme: c.theme,
      status: c.status,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      submissionCount: c._count.submissions,
      winners: JSON.parse(c.winnersJson || "[]"),
    })),
  };
  await cacheSet("comps:list", JSON.stringify(payload), 120_000);
  return res.json(payload);
});

// GET /api/competitions/active
competitionsRouter.get("/active", async (_req, res) => {
  const cached = await cacheGet("comps:active");
  if (cached) return res.json(JSON.parse(cached));
  const comp = await prisma.competition.findFirst({
    where: { status: "open" },
    include: { _count: { select: { submissions: true } } },
  });
  const payload = comp
    ? {
        active: true,
        id: comp.id,
        title: comp.title,
        theme: comp.theme,
        startsAt: comp.startsAt,
        endsAt: comp.endsAt,
        submissionCount: comp._count.submissions,
      }
    : { active: false };
  await cacheSet("comps:active", JSON.stringify(payload), 60_000);
  return res.json(payload);
});

// GET /api/competitions/:id
competitionsRouter.get("/:id", async (req, res) => {
  const comp = await prisma.competition.findUnique({
    where: { id: req.params.id },
  });
  if (!comp) return res.status(404).json({ error: "Competition not found" });
  return res.json({
    ...comp,
    winners: JSON.parse(comp.winnersJson || "[]"),
  });
});

// GET /api/competitions/:id/leaderboard — cached 60s
competitionsRouter.get("/:id/leaderboard", async (req, res) => {
  const key = `lb:${req.params.id}`;
  const cached = await cacheGet(key);
  if (cached) return res.json(JSON.parse(cached));

  const subs = await prisma.submission.findMany({
    where: {
      competitionId: req.params.id,
      status: { in: ["evaluated", "winner"] },
    },
    orderBy: [{ totalScore: "desc" }, { id: "asc" }],
    take: 100,
    include: { user: { select: { username: true, walletAddress: true } } },
  });
  const payload = {
    leaderboard: subs.map((s, i) => ({
      rank: i + 1,
      submissionId: s.id,
      title: s.title,
      imageUrl: s.imageUrl,
      username: s.user.username,
      walletAddress: s.user.walletAddress,
      score: s.totalScore,
      criteria: JSON.parse(s.criteriaJson || "{}"),
      status: s.status,
      plagiarismVerdict: s.plagiarismVerdict,
    })),
  };
  await cacheSet(key, JSON.stringify(payload), 60_000);
  return res.json(payload);
});

// GET /api/competitions/:id/onchain — live view straight from the contract
competitionsRouter.get("/:id/onchain", async (req, res) => {
  if (!gl.isChainConfigured()) {
    return res.status(503).json({ error: "Contract not configured yet" });
  }
  try {
    const data = await gl.getOnchainCompetition(req.params.id);
    return res.json({ onchain: data });
  } catch (err) {
    return res.status(502).json({ error: (err as Error).message });
  }
});
