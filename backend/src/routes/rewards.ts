import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { limit } from "../middleware/rateLimit";
import { decryptPrivateKey } from "../lib/walletCrypto";
import * as gl from "../services/genlayer";
import { logger } from "../lib/logger";

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

// POST /api/rewards/claim — pull your full claimable GEN reward balance out
// of the contract's own escrowed funds, via a genuine on-chain transfer
// signed by your own wallet. Self-serve; the contract enforces that only
// the caller can claim their own balance.
rewardsRouter.post(
  "/claim",
  requireAuth,
  limit("claim-reward", 10, 3600),
  async (req: AuthedRequest, res: Response) => {
    if (!gl.isChainConfigured()) {
      return res.status(503).json({ error: "Contract not configured yet" });
    }
    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const before = await gl.getOnchainRewardBalance(user.walletAddress).catch(() => "0");
    if (BigInt(String(before || "0")) <= BigInt(0)) {
      return res.status(400).json({ error: "No claimable GEN reward" });
    }

    try {
      const txHash = await gl.claimRewardOnChain(
        decryptPrivateKey(user.encryptedPrivateKey)
      );
      const after = await gl
        .getOnchainRewardBalance(user.walletAddress)
        .catch(() => "0");
      return res.json({
        txHash,
        claimedAtto: (BigInt(String(before)) - BigInt(String(after || "0"))).toString(),
        remainingBalanceAtto: String(after || "0"),
      });
    } catch (err) {
      logger.error({ err: (err as Error).message }, "claim_reward failed");
      return res.status(502).json({ error: (err as Error).message });
    }
  }
);
