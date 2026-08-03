import { Router, Response } from "express";
import { ethers } from "ethers";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import * as escrow from "../services/baseSepolia";
import { config } from "../lib/config";
import { MEME_OLYMPICS_ESCROW_ABI } from "../lib/escrowAbi";

export const rewardsRouter = Router();

function toUsdc(baseUnits: string): number {
  return Number(BigInt(baseUnits)) / 1e6;
}

// GET /api/rewards/me — declared USDC (GenLayer bookkeeping) + real
// claimable USDC per won competition on the Base Sepolia escrow, plus
// off-chain win history. Actual claiming happens on Base Sepolia, signed by
// the user's own connected wallet — see POST /claim-calldata below.
rewardsRouter.get("/me", requireAuth, async (req: AuthedRequest, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return res.status(404).json({ error: "User not found" });

  const wins = await prisma.submission.findMany({
    where: { userId: user.id, status: "winner" },
    orderBy: { updatedAt: "desc" },
    include: {
      competition: { select: { id: true, title: true, relayTxHash: true, winnersJson: true } },
    },
  });

  // Declared reward per win, straight from each competition's own
  // finalize-time snapshot (not GenLayer's cumulative all-time ledger,
  // which never decrements on claim and so can't distinguish "not yet
  // relayed" from "relayed and already fully claimed").
  function declaredForWin(w: (typeof wins)[number]): bigint {
    try {
      const entry = (JSON.parse(w.competition.winnersJson || "[]") as Array<{
        submission_id: string;
        reward_usdc: string;
      }>).find((x) => x.submission_id === w.id);
      return BigInt(entry?.reward_usdc || "0");
    } catch {
      return BigInt(0);
    }
  }

  let claimableByCompetition: Record<string, string> = {};
  let totalClaimableUsdc = "0";
  if (escrow.isEscrowConfigured()) {
    const uniqueCompetitionIds = [...new Set(wins.map((w) => w.competition.id))];
    const amounts = await Promise.all(
      uniqueCompetitionIds.map((id) =>
        escrow.getEscrowClaimable(id, user.authAddress).catch(() => "0")
      )
    );
    let total = BigInt(0);
    uniqueCompetitionIds.forEach((id, i) => {
      claimableByCompetition[id] = amounts[i];
      total += BigInt(amounts[i] || "0");
    });
    totalClaimableUsdc = total.toString();
  }

  const pendingRelayUsdc = wins
    .filter((w) => !w.competition.relayTxHash)
    .reduce((sum, w) => sum + declaredForWin(w), BigInt(0))
    .toString();

  const walletUsdcBaseUnits = await escrow
    .getWalletUsdcBalance(user.authAddress)
    .catch(() => "0");

  return res.json({
    walletAddress: user.authAddress,
    walletUsdcBaseUnits,
    walletUsdc: toUsdc(walletUsdcBaseUnits),
    pendingRelayUsdcBaseUnits: pendingRelayUsdc,
    pendingRelayUsdc: toUsdc(pendingRelayUsdc),
    totalClaimableUsdcBaseUnits: totalClaimableUsdc,
    totalClaimableUsdc: toUsdc(totalClaimableUsdc),
    claimableByCompetition,
    escrow: {
      chain: "base-sepolia",
      address: config.baseSepolia.escrowAddress || null,
      usdcAddress: config.baseSepolia.usdcAddress,
    },
    wins: wins.map((w) => ({
      submissionId: w.id,
      title: w.title,
      imageUrl: w.imageUrl,
      score: w.totalScore,
      competition: { id: w.competition.id, title: w.competition.title },
      relayed: Boolean(w.competition.relayTxHash),
      declaredUsdcBaseUnits: declaredForWin(w).toString(),
      claimableUsdcBaseUnits: claimableByCompetition[w.competition.id] || "0",
    })),
  });
});

// POST /api/rewards/claim-calldata — returns the exact transaction the
// frontend should ask the user's own wallet (MetaMask etc. on Base Sepolia)
// to send. The backend never holds or moves the user's USDC: claiming is a
// self-serve pull the user signs themselves against MemeOlympicsEscrow.
rewardsRouter.post(
  "/claim-calldata",
  requireAuth,
  async (req: AuthedRequest, res: Response) => {
    if (!escrow.isEscrowConfigured()) {
      return res.status(503).json({ error: "Escrow contract not configured yet" });
    }
    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const wins = await prisma.submission.findMany({
      where: { userId: user.id, status: "winner" },
      include: { competition: { select: { id: true } } },
    });
    const uniqueCompetitionIds = [...new Set(wins.map((w) => w.competition.id))];
    const amounts = await Promise.all(
      uniqueCompetitionIds.map((id) =>
        escrow.getEscrowClaimable(id, user.authAddress).catch(() => "0")
      )
    );
    const claimableIds = uniqueCompetitionIds.filter(
      (_, i) => BigInt(amounts[i] || "0") > BigInt(0)
    );
    if (claimableIds.length === 0) {
      return res.status(400).json({ error: "Nothing claimable yet" });
    }

    const iface = new ethers.Interface(MEME_OLYMPICS_ESCROW_ABI);
    const keys = claimableIds.map((id) => escrow.competitionIdToBytes32(id));
    const data =
      keys.length === 1
        ? iface.encodeFunctionData("claim", [keys[0]])
        : iface.encodeFunctionData("claimMany", [keys]);

    return res.json({
      chain: "base-sepolia",
      chainId: 84532,
      to: config.baseSepolia.escrowAddress,
      data,
      value: "0x0",
      competitionIds: claimableIds,
    });
  }
);
