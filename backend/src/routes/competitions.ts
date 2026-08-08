import { Router, Response } from "express";
import { z } from "zod";
import { ethers } from "ethers";
import { prisma } from "../lib/prisma";
import { cacheGet, cacheSet } from "../lib/redis";
import { requireAuth, requireAdmin, AuthedRequest } from "../middleware/auth";
import { limit } from "../middleware/rateLimit";
import * as gl from "../services/genlayer";
import * as escrow from "../services/baseSepolia";
import { scheduleClose } from "../jobs/weekly";
import { config } from "../lib/config";
import { MEME_OLYMPICS_ESCROW_ABI, ERC20_ABI } from "../lib/escrowAbi";

export const competitionsRouter = Router();

// USDC has 6 decimals. NOTE: the `prizeAtto` DB column name is legacy (kept
// to avoid a migration) but stores USDC base units now, not 18-decimal GEN.
const USDC_UNIT = BigInt(10) ** BigInt(6);

// Statuses that count as "this arena is still active" for the global
// one-at-a-time lock (item 7): nothing new may open until the current
// arena has been closed, judged, and finalized.
const ACTIVE_COMPETITION_STATUSES = ["created", "open", "judging"];
const MAX_ARENA_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

// POST /api/competitions — ADMIN-ONLY: hosting an arena is a tool for the
// admin wallet, not general users (see requireAdmin below). GenLayer itself
// never escrows value — `prizeUsdc` (optional, may be 0 for a
// prestige-only arena) is only the DECLARED prize amount recorded on-chain
// for display/ranking. The host still needs to actually deposit that USDC
// on the Base Sepolia escrow contract (see GET /:id/escrow-fund-calldata)
// for it to be real, claimable money.
competitionsRouter.post(
  "/",
  requireAuth,
  requireAdmin,
  limit("create-comp", 3, 86400),
  async (req: AuthedRequest, res: Response) => {
    const schema = z.object({
      title: z.string().min(3).max(120),
      theme: z.string().max(600).default(""),
      endsAt: z.string().refine((s) => !isNaN(Date.parse(s)), "Invalid date"),
      prizeUsdc: z.number().min(0).max(1_000_000).default(0),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const { title, theme, endsAt, prizeUsdc } = parsed.data;
    const now = new Date();
    if (new Date(endsAt) <= now) {
      return res.status(400).json({ error: "End date must be in the future" });
    }
    if (new Date(endsAt).getTime() > now.getTime() + MAX_ARENA_DURATION_MS) {
      return res.status(400).json({ error: "End date must be within 1 week" });
    }

    // Global one-arena-at-a-time lock: no new arena until the current one
    // is closed, judged, and finalized.
    const activeComp = await prisma.competition.findFirst({
      where: { status: { in: ACTIVE_COMPETITION_STATUSES } },
    });
    if (activeComp) {
      return res.status(409).json({
        error: `Another arena ("${activeComp.title}") is still active — wait for it to finalize before opening a new one.`,
      });
    }

    // Idempotency: a retry of a partially-failed creation (e.g. the
    // on-chain create_competition/open_competition step failed after this
    // DB row was already created) should resume the same row instead of
    // spawning a duplicate arena.
    const recentDuplicate = await prisma.competition.findFirst({
      where: {
        createdByUserId: req.userId!,
        title,
        endsAt: new Date(endsAt),
        createdAt: { gte: new Date(Date.now() - 60_000) },
      },
    });
    if (recentDuplicate) {
      const prizeUsdcUnitsExisting = BigInt(recentDuplicate.prizeAtto);
      return res.status(200).json({
        competition: recentDuplicate,
        genlayer: {
          functionArgs: [
            recentDuplicate.id,
            recentDuplicate.title,
            recentDuplicate.theme,
            recentDuplicate.startsAt.toISOString(),
            recentDuplicate.endsAt.toISOString(),
            Number(prizeUsdcUnitsExisting),
          ],
        },
        escrow:
          prizeUsdcUnitsExisting > BigInt(0)
            ? {
                note: "Deposit the declared USDC on Base Sepolia to back this prize pool — see GET /:id/escrow-fund-calldata.",
                competitionIdBytes32: escrow.competitionIdToBytes32(recentDuplicate.id),
              }
            : null,
      });
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

    const prizeUsdcUnits = BigInt(Math.round(prizeUsdc * 1e6));

    const comp = await prisma.competition.create({
      data: {
        id,
        title,
        theme,
        status: "open",
        startsAt: new Date(),
        endsAt: new Date(endsAt),
        createdByUserId: req.userId!,
        prizeAtto: prizeUsdcUnits.toString(),
      },
    });

    return res.status(201).json({
      competition: comp,
      // Frontend signs create_competition + open_competition itself (see
      // lib/genlayer.ts) — this backend holds no user private keys. Once
      // those transactions land, call POST /:id/onchain-confirm.
      genlayer: {
        functionArgs: [id, title, theme, comp.startsAt.toISOString(), comp.endsAt.toISOString(), Number(prizeUsdcUnits)],
      },
      escrow:
        prizeUsdcUnits > BigInt(0)
          ? {
              note: "Deposit the declared USDC on Base Sepolia to back this prize pool — see GET /:id/escrow-fund-calldata.",
              competitionIdBytes32: escrow.competitionIdToBytes32(id),
            }
          : null,
    });
  }
);

// POST /api/competitions/:id/onchain-confirm — called by the frontend once
// its own wallet-signed create_competition + open_competition transactions
// land. Verified against GenLayer itself, not just trusted from the client.
competitionsRouter.post(
  "/:id/onchain-confirm",
  requireAuth,
  async (req: AuthedRequest, res: Response) => {
    const comp = await prisma.competition.findUnique({ where: { id: req.params.id } });
    if (!comp || comp.createdByUserId !== req.userId) {
      return res.status(404).json({ error: "Competition not found" });
    }
    if (!gl.isChainConfigured()) {
      return res.status(503).json({ error: "Contract not configured yet" });
    }
    // Reads can lag moments behind a just-ACCEPTED write — retry rather
    // than failing the whole confirm (and skipping the prize deposit step
    // that follows it client-side) on the first transient miss.
    const onchain = await gl.readUntilFound<{ status?: string }>(
      "get_competition",
      [comp.id],
      (v) => v?.status === "open"
    );
    if (!onchain) {
      return res.status(409).json({ error: "Competition not found (or not yet 'open') on-chain" });
    }
    const updated = await prisma.competition.update({
      where: { id: comp.id },
      data: { onchainCreated: true },
    });
    // Defense-in-depth: keep the contract's own per-user submission cap
    // aligned with the backend's 1-submission-per-user rule. Only needed
    // the first time this arena confirms — this route is also what
    // "RESYNC FROM CHAIN" calls, and re-sending this write on every resync
    // of an already-confirmed arena serves no purpose and can error
    // on-chain, so it must not fire on repeat confirms.
    if (!comp.onchainCreated) {
      gl.setCompetitionDefaultsOnChain(3, 1).catch(() => undefined);
    }
    scheduleClose(comp.id, comp.endsAt);
    return res.json({ competition: updated });
  }
);

// POST /api/competitions/:id/fund-confirm — called by the frontend once its
// own wallet-signed fund_competition transaction lands. Syncs our DB's
// declared prize amount to whatever GenLayer now actually reports, rather
// than trusting a client-supplied delta.
competitionsRouter.post(
  "/:id/fund-confirm",
  requireAuth,
  limit("fund-comp", 10, 3600),
  async (req: AuthedRequest, res: Response) => {
    if (!gl.isChainConfigured()) {
      return res.status(503).json({ error: "Contract not configured yet" });
    }
    const comp = await prisma.competition.findUnique({ where: { id: req.params.id } });
    if (!comp) return res.status(404).json({ error: "Competition not found" });
    if (comp.createdByUserId !== req.userId) {
      return res.status(403).json({ error: "Only the arena creator can fund this pool" });
    }

    try {
      const onchain = (await gl.getOnchainCompetition(comp.id)) as {
        prize_pool_usdc?: string;
      };
      const updated = await prisma.competition.update({
        where: { id: comp.id },
        data: { prizeAtto: String(onchain?.prize_pool_usdc ?? comp.prizeAtto) },
      });
      return res.json({ competition: updated });
    } catch (err) {
      return res.status(502).json({ error: (err as Error).message });
    }
  }
);

// GET /api/competitions/:id/escrow-fund-calldata?amountUsdc=N — returns the
// approve() + fundCompetition() calldata the frontend should send via the
// user's own connected wallet on Base Sepolia (the same wallet used
// everywhere else in this app). Only the arena's creator can fund its
// pool — visible/usable only to them.
competitionsRouter.get(
  "/:id/escrow-fund-calldata",
  requireAuth,
  async (req: AuthedRequest, res: Response) => {
  if (!config.baseSepolia.escrowAddress) {
    return res.status(503).json({ error: "Escrow contract not configured yet" });
  }
  const comp = await prisma.competition.findUnique({ where: { id: req.params.id } });
  if (!comp) return res.status(404).json({ error: "Competition not found" });
  if (comp.createdByUserId !== req.userId) {
    return res.status(403).json({ error: "Only the arena creator can fund this pool" });
  }
  const amountUsdc = Number(req.query.amountUsdc || 0);
  if (!(amountUsdc > 0)) {
    return res.status(400).json({ error: "amountUsdc must be > 0" });
  }
  const amountUnits = BigInt(Math.round(amountUsdc * 1e6));
  const key = escrow.competitionIdToBytes32(req.params.id);
  const escrowIface = new ethers.Interface(MEME_OLYMPICS_ESCROW_ABI);
  const erc20Iface = new ethers.Interface(ERC20_ABI);
  return res.json({
    chain: "base-sepolia",
    chainId: 84532,
    usdcAddress: config.baseSepolia.usdcAddress,
    escrowAddress: config.baseSepolia.escrowAddress,
    amountUnits: amountUnits.toString(),
    steps: [
      {
        label: "Approve USDC",
        to: config.baseSepolia.usdcAddress,
        data: erc20Iface.encodeFunctionData("approve", [
          config.baseSepolia.escrowAddress,
          amountUnits,
        ]),
        value: "0x0",
      },
      {
        label: "Deposit into competition pool",
        to: config.baseSepolia.escrowAddress,
        data: escrowIface.encodeFunctionData("fundCompetition", [key, amountUnits]),
        value: "0x0",
      },
    ],
  });
});

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
      prizeUsdcBaseUnits: c.prizeAtto,
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
        prizeUsdcBaseUnits: comp.prizeAtto,
      }
    : { active: false };
  await cacheSet("comps:active", JSON.stringify(payload), 60_000);
  return res.json(payload);
});

// GET /api/competitions/:id — the Arena Detail page's main call, and its
// heaviest-hit read (page load + every poll tick). Short TTL so status
// changes (open → judging → finalized) still surface promptly.
competitionsRouter.get("/:id", async (req, res) => {
  const key = `comp:${req.params.id}`;
  const cached = await cacheGet(key);
  if (cached) return res.json(JSON.parse(cached));
  const comp = await prisma.competition.findUnique({
    where: { id: req.params.id },
  });
  if (!comp) return res.status(404).json({ error: "Competition not found" });
  const winners = JSON.parse(comp.winnersJson || "[]") as Array<{
    submission_id: string;
    author: string;
    rank: number;
    score: number;
    reward_usdc: string;
  }>;

  // Enrich each winner with its actual meme + judging details, so the
  // arena page can show the image and review instead of just an address.
  let enrichedWinners: unknown[] = winners;
  if (winners.length > 0) {
    const subs = await prisma.submission.findMany({
      where: { id: { in: winners.map((w) => w.submission_id) } },
      include: { user: { select: { username: true, authAddress: true } } },
    });
    const byId = new Map(subs.map((s) => [s.id, s]));
    enrichedWinners = winners.map((w) => {
      const sub = byId.get(w.submission_id);
      return {
        ...w,
        title: sub?.title || "",
        imageUrl: sub?.imageUrl || "",
        caption: sub?.caption || "",
        tags: sub ? JSON.parse(sub.tagsJson || "[]") : [],
        criteria: sub ? JSON.parse(sub.criteriaJson || "{}") : {},
        plagiarismVerdict: sub?.plagiarismVerdict || "",
        evaluationSummary: sub?.evaluationSummary || "",
        username:
          sub?.user.username || (sub ? `wallet_${sub.user.authAddress.slice(2, 8)}` : ""),
      };
    });
  }

  const payload = {
    ...comp,
    winners: enrichedWinners,
  };
  await cacheSet(key, JSON.stringify(payload), 15_000);
  return res.json(payload);
});

// GET /api/competitions/:id/leaderboard — cached 60s. Before finalization,
// only evaluated/winner entries show (live, in-progress judging). Once the
// arena is finalized, every entry is shown, with disqualified memes split
// into their own `disqualified` section instead of being hidden.
competitionsRouter.get("/:id/leaderboard", async (req, res) => {
  const key = `lb:${req.params.id}`;
  const cached = await cacheGet(key);
  if (cached) return res.json(JSON.parse(cached));

  const comp = await prisma.competition.findUnique({ where: { id: req.params.id } });
  const finalized = comp?.status === "finalized";

  const toEntry = (s: {
    id: string;
    title: string;
    imageUrl: string;
    totalScore: number | null;
    criteriaJson: string;
    status: string;
    plagiarismVerdict: string | null;
    user: { username: string | null; authAddress: string };
  }) => ({
    submissionId: s.id,
    title: s.title,
    imageUrl: s.imageUrl,
    username: s.user.username || `wallet_${s.user.authAddress.slice(2, 8)}`,
    walletAddress: s.user.authAddress,
    score: s.totalScore,
    criteria: JSON.parse(s.criteriaJson || "{}"),
    status: s.status,
    plagiarismVerdict: s.plagiarismVerdict,
  });

  const orderBy = [{ totalScore: "desc" as const }, { id: "asc" as const }];
  const include = { user: { select: { username: true, authAddress: true } } };
  const take = 500; // matches the contract's MAX_SUBMISSIONS_PER_COMPETITION

  let payload: { leaderboard: unknown[]; disqualified?: unknown[] };
  if (!finalized) {
    const subs = await prisma.submission.findMany({
      where: { competitionId: req.params.id, status: { in: ["evaluated", "winner"] } },
      orderBy,
      take,
      include,
    });
    payload = { leaderboard: subs.map((s, i) => ({ rank: i + 1, ...toEntry(s) })) };
  } else {
    const [subs, disqualifiedSubs] = await Promise.all([
      prisma.submission.findMany({
        where: {
          competitionId: req.params.id,
          status: { in: ["evaluated", "winner", "failed"] },
        },
        orderBy,
        take,
        include,
      }),
      prisma.submission.findMany({
        where: { competitionId: req.params.id, status: "disqualified" },
        orderBy,
        take,
        include,
      }),
    ]);
    payload = {
      leaderboard: subs.map((s, i) => ({ rank: i + 1, ...toEntry(s) })),
      disqualified: disqualifiedSubs.map((s) => toEntry(s)),
    };
  }
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
