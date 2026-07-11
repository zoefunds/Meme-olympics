import { Router, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { limit } from "../middleware/rateLimit";
import { decryptPrivateKey } from "../lib/walletCrypto";
import * as gl from "../services/genlayer";
import { logger } from "../lib/logger";

export const disputesRouter = Router();

// POST /api/disputes — must include a public evidence URL; the contract
// fetches it on-chain, claims are never resolved from text alone.
disputesRouter.post(
  "/",
  requireAuth,
  limit("dispute", 3, 86400),
  async (req: AuthedRequest, res: Response) => {
    const schema = z.object({
      submissionId: z.string(),
      reason: z.string().min(10).max(1000),
      evidenceUrl: z.string().url().max(500),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const { submissionId, reason, evidenceUrl } = parsed.data;

    const sub = await prisma.submission.findUnique({ where: { id: submissionId } });
    if (!sub || !["evaluated", "winner"].includes(sub.status)) {
      return res
        .status(400)
        .json({ error: "Only evaluated or winning submissions can be disputed" });
    }

    const dispute = await prisma.dispute.create({
      data: { submissionId, userId: req.userId!, reason, evidenceUrl },
    });

    if (gl.isChainConfigured()) {
      try {
        const user = await prisma.user.findUnique({ where: { id: req.userId! } });
        await gl.openDisputeOnChain(
          decryptPrivateKey(user!.encryptedPrivateKey),
          dispute.id,
          submissionId,
          reason,
          evidenceUrl,
          new Date().toISOString()
        );
      } catch (err) {
        logger.error({ err: (err as Error).message }, "on-chain dispute failed");
      }
    }

    return res.status(201).json({ dispute });
  }
);

// GET /api/disputes — recent disputes (public transparency)
disputesRouter.get("/", async (_req, res) => {
  const disputes = await prisma.dispute.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      submission: { select: { title: true, imageUrl: true } },
      user: { select: { username: true } },
    },
  });
  return res.json({ disputes });
});
