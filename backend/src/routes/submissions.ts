import { Router, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { limit } from "../middleware/rateLimit";
import { decryptPrivateKey } from "../lib/walletCrypto";
import * as gl from "../services/genlayer";
import { logger } from "../lib/logger";

export const submissionsRouter = Router();

const submitSchema = z.object({
  competitionId: z.string().min(3).max(64),
  title: z.string().min(1).max(120),
  caption: z.string().max(600).default(""),
  imageUrl: z.string().url().max(500),
  contextUrl: z.string().url().max(500).optional().or(z.literal("")),
  tags: z.array(z.string().min(1).max(32)).max(8).default([]),
});

// POST /api/submissions — register meme, then push on-chain with user's wallet
submissionsRouter.post(
  "/",
  requireAuth,
  limit("submit", 5, 3600),
  async (req: AuthedRequest, res: Response) => {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const data = parsed.data;

    const comp = await prisma.competition.findUnique({
      where: { id: data.competitionId },
    });
    if (!comp || comp.status !== "open") {
      return res.status(400).json({ error: "Competition is not open" });
    }

    const mine = await prisma.submission.count({
      where: { competitionId: comp.id, userId: req.userId! },
    });
    if (mine >= 3) {
      return res
        .status(400)
        .json({ error: "You already used all 3 submissions this week" });
    }

    const duplicate = await prisma.submission.findFirst({
      where: { imageUrl: data.imageUrl },
    });
    if (duplicate) {
      return res.status(409).json({ error: "This image URL was already submitted" });
    }

    const sub = await prisma.submission.create({
      data: {
        competitionId: comp.id,
        userId: req.userId!,
        title: data.title,
        caption: data.caption,
        imageUrl: data.imageUrl,
        contextUrl: data.contextUrl || "",
        tagsJson: JSON.stringify(data.tags),
        status: "pending",
      },
    });

    // Push on-chain signed by the user's own custodial wallet.
    if (gl.isChainConfigured()) {
      try {
        const user = await prisma.user.findUnique({ where: { id: req.userId! } });
        const txHash = await gl.submitMemeOnChain(
          decryptPrivateKey(user!.encryptedPrivateKey),
          comp.id,
          sub.id,
          data.title,
          data.caption,
          data.imageUrl,
          data.contextUrl || "",
          JSON.stringify(data.tags),
          new Date().toISOString()
        );
        await prisma.submission.update({
          where: { id: sub.id },
          data: { status: "onchain", onchainTxHash: txHash },
        });
        sub.status = "onchain";
        sub.onchainTxHash = txHash;
      } catch (err) {
        logger.error({ err: (err as Error).message }, "on-chain submit failed");
        // Keep the row; the judging worker retries pending submissions.
      }
    }

    return res.status(201).json({ submission: sub });
  }
);

// GET /api/submissions/mine
submissionsRouter.get(
  "/mine",
  requireAuth,
  async (req: AuthedRequest, res: Response) => {
    const subs = await prisma.submission.findMany({
      where: { userId: req.userId! },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return res.json({
      submissions: subs.map((s) => ({
        ...s,
        tags: JSON.parse(s.tagsJson || "[]"),
        criteria: JSON.parse(s.criteriaJson || "{}"),
      })),
    });
  }
);

// GET /api/submissions/:id
submissionsRouter.get("/:id", async (req, res) => {
  const sub = await prisma.submission.findUnique({
    where: { id: req.params.id },
    include: { user: { select: { username: true } } },
  });
  if (!sub) return res.status(404).json({ error: "Submission not found" });
  return res.json({
    submission: {
      ...sub,
      tags: JSON.parse(sub.tagsJson || "[]"),
      criteria: JSON.parse(sub.criteriaJson || "{}"),
    },
  });
});
