import { Router, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { cacheGet, cacheSet } from "../lib/redis";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { limit } from "../middleware/rateLimit";
import { decryptPrivateKey } from "../lib/walletCrypto";
import * as gl from "../services/genlayer";
import { logger } from "../lib/logger";

export const competitionsRouter = Router();

const ATTO = BigInt(10) ** BigInt(18);

// POST /api/competitions — OPEN TO ALL signed-in users: anyone can host an
// arena, signed and funded by their OWN wallet. `prizeGen` (optional, may be
// 0 for a prestige-only arena) is sent as real GEN value with the creation
// transaction and becomes the competition's escrowed, on-chain prize pool.
competitionsRouter.post(
  "/",
  requireAuth,
  limit("create-comp", 3, 86400),
  async (req: AuthedRequest, res: Response) => {
    const schema = z.object({
      title: z.string().min(3).max(120),
      theme: z.string().max(600).default(""),
      endsAt: z.string().refine((s) => !isNaN(Date.parse(s)), "Invalid date"),
      prizeGen: z.number().min(0).max(1_000_000).default(0),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const { title, theme, endsAt, prizeGen } = parsed.data;
    if (new Date(endsAt) <= new Date()) {
      return res.status(400).json({ error: "End date must be in the future" });
    }

    // Derive a unique slug id from the title.
    const base = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "arena";
    let id = `arena-${base}`;
    if (await prisma.competition.findUnique({ where: { id } })) {
      id = `arena-${base}-${Date.now().toString(36)}`;
    }

    const prizeAtto = BigInt(Math.round(prizeGen * 1e6)) * (ATTO / BigInt(1e6));

    const comp = await prisma.competition.create({
      data: {
        id,
        title,
        theme,
        status: "open",
        startsAt: new Date(),
        endsAt: new Date(endsAt),
        createdByUserId: req.userId!,
        prizeAtto: prizeAtto.toString(),
      },
    });

    if (gl.isChainConfigured()) {
      try {
        const user = await prisma.user.findUnique({ where: { id: req.userId! } });
        // Signed and funded by the HOST's own wallet — a genuine value
        // transfer, not the backend operator paying on their behalf.
        await gl.createCompetitionAsUser(
          decryptPrivateKey(user!.encryptedPrivateKey),
          id,
          title,
          theme,
          comp.startsAt.toISOString(),
          comp.endsAt.toISOString(),
          prizeAtto
        );
        await gl.openCompetitionOnChain(id);
        await prisma.competition.update({
          where: { id },
          data: { onchainCreated: true },
        });
      } catch (err) {
        logger.error(
          { err: (err as Error).message, comp: id },
          "on-chain competition creation failed (kept off-chain)"
        );
        return res.status(502).json({
          error:
            "Could not fund/create this arena on-chain (check your wallet's GEN balance). " +
            (err as Error).message,
        });
      }
    }
    return res.status(201).json({ competition: comp });
  }
);

// POST /api/competitions/:id/fund — anyone can top up an arena's real GEN
// prize pool with their own wallet, any time before it finalizes.
competitionsRouter.post(
  "/:id/fund",
  requireAuth,
  limit("fund-comp", 10, 3600),
  async (req: AuthedRequest, res: Response) => {
    if (!gl.isChainConfigured()) {
      return res.status(503).json({ error: "Contract not configured yet" });
    }
    const schema = z.object({ amountGen: z.number().positive().max(1_000_000) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const comp = await prisma.competition.findUnique({ where: { id: req.params.id } });
    if (!comp) return res.status(404).json({ error: "Competition not found" });
    if (["finalized", "cancelled"].includes(comp.status)) {
      return res.status(400).json({ error: "This arena can no longer be funded" });
    }
    const amountAtto = BigInt(Math.round(parsed.data.amountGen * 1e6)) * (ATTO / BigInt(1e6));

    try {
      const user = await prisma.user.findUnique({ where: { id: req.userId! } });
      await gl.fundCompetitionOnChain(
        decryptPrivateKey(user!.encryptedPrivateKey),
        comp.id,
        amountAtto
      );
      const updated = await prisma.competition.update({
        where: { id: comp.id },
        data: { prizeAtto: (BigInt(comp.prizeAtto) + amountAtto).toString() },
      });
      return res.json({ competition: updated });
    } catch (err) {
      return res.status(502).json({ error: (err as Error).message });
    }
  }
);

// GET /api/competitions — list (cached 120s)
competitionsRouter.get("/", async (_req, res) => {
  const cached = await cacheGet("comps:list");
  if (cached) return res.json(JSON.parse(cached));
  const comps = await prisma.competition.findMany({
    orderBy: { startsAt: "desc" },
    take: 50,
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
      prizeAtto: c.prizeAtto,
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
        prizeAtto: comp.prizeAtto,
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
    take: 500, // matches the contract's MAX_SUBMISSIONS_PER_COMPETITION
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
