import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { limit } from "../middleware/rateLimit";
import { decryptPrivateKey } from "../lib/walletCrypto";
import * as gl from "../services/genlayer";
import { logger } from "../lib/logger";

export const rewardsRouter = Router();

function toGen(atto: string): number {
  return Number(BigInt(atto) / BigInt(10 ** 14)) / 10000;
}

// GET /api/rewards/me — real wallet GEN balance (dashboard) + claimable
// escrow + off-chain win history
rewardsRouter.get("/me", requireAuth, async (req: AuthedRequest, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return res.status(404).json({ error: "User not found" });

  const wins = await prisma.submission.findMany({
    where: { userId: user.id, status: "winner" },
    orderBy: { updatedAt: "desc" },
    include: { competition: { select: { id: true, title: true } } },
  });

  let onchainBalanceAtto = "0"; // claimable, still escrowed by the contract
  let walletBalanceAtto = "0"; // real spendable GEN in the user's own wallet
  if (gl.isChainConfigured()) {
    await Promise.all([
      gl
        .getOnchainRewardBalance(user.walletAddress)
        .then((v) => (onchainBalanceAtto = String(v)))
        .catch(() => undefined),
      gl
        .getWalletBalance(user.walletAddress)
        .then((v) => (walletBalanceAtto = v))
        .catch(() => undefined),
    ]);
  }

  return res.json({
    walletAddress: user.walletAddress,
    walletBalanceAtto,
    walletBalance: toGen(walletBalanceAtto),
    onchainBalanceAtto,
    onchainBalance: toGen(onchainBalanceAtto),
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

    const claimableBefore = await gl
      .getOnchainRewardBalance(user.walletAddress)
      .catch(() => "0");
    if (BigInt(String(claimableBefore || "0")) <= BigInt(0)) {
      return res.status(400).json({ error: "No claimable GEN reward" });
    }
    const walletBefore = await gl.getWalletBalance(user.walletAddress).catch(() => "0");

    try {
      const txHash = await gl.claimRewardOnChain(
        decryptPrivateKey(user.encryptedPrivateKey)
      );
      // Same read-after-write lag we've hit elsewhere, at two levels here:
      // (1) the contract's own escrow needs to read back to 0, and
      // (2) the TRIGGERED follow-up transfer transaction needs to actually
      // land in the wallet's real balance, which settles slightly after
      // the claim_reward call itself finalizes. Poll wallet balance, not
      // just the claim tx status, before reporting success.
      const walletAfter = await gl.waitForWalletIncrease(
        user.walletAddress,
        walletBefore
      );
      const claimableAfter = await gl
        .getOnchainRewardBalance(user.walletAddress)
        .catch(() => "0");

      return res.json({
        txHash,
        claimedAtto: (BigInt(String(claimableBefore)) - BigInt(String(claimableAfter || "0"))).toString(),
        remainingClaimableAtto: String(claimableAfter || "0"),
        walletBalanceBeforeAtto: walletBefore,
        walletBalanceAfterAtto: walletAfter,
        settled: BigInt(walletAfter) > BigInt(walletBefore),
      });
    } catch (err) {
      logger.error({ err: (err as Error).message }, "claim_reward failed");
      return res.status(502).json({ error: (err as Error).message });
    }
  }
);
