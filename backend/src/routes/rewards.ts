import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import * as gl from "../services/genlayer";

export const rewardsRouter = Router();

// GET /api/rewards/me — off-chain summary + on-chain balance when available
rewardsRouter.get("/me", requireAuth, async (req: AuthedRequest, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return res.status(404).json({ error: "User not found" });

  const wins = await prisma.submission.findMany({
    where: { userId: user.id, status: "winner" },
    orderBy: { updatedAt: "desc" },
    include: { competition: { select: { id: true, title: true } } },
  });

  let onchainBalanceAtto = "0";
  if (gl.isChainConfigured()) {
    try {
      onchainBalanceAtto = String(
        await gl.getOnchainRewardBalance(user.walletAddress)
      );
    } catch {
      /* chain read best-effort */
    }
  }

  return res.json({
    walletAddress: user.walletAddress,
    onchainBalanceAtto,
    onchainBalance: Number(BigInt(onchainBalanceAtto) / BigInt(10 ** 14)) / 10000,
    wins: wins.map((w) => ({
      submissionId: w.id,
      title: w.title,
      imageUrl: w.imageUrl,
      score: w.totalScore,
      competition: w.competition,
    })),
  });
});
