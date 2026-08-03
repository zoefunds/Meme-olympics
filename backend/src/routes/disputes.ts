import { Router, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { limit } from "../middleware/rateLimit";
import * as gl from "../services/genlayer";

export const disputesRouter = Router();

// POST /api/disputes — must include a public evidence URL; the contract
// fetches it on-chain, claims are never resolved from text alone. The
// on-chain open_dispute call is signed by the CALLER'S OWN wallet from the
// frontend (see lib/genlayer.ts) — call POST /:id/onchain-confirm once it
// lands.
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

    return res.status(201).json({ dispute });
  }
);

// POST /api/disputes/:id/onchain-confirm
disputesRouter.post(
  "/:id/onchain-confirm",
  requireAuth,
  async (req: AuthedRequest, res: Response) => {
    const dispute = await prisma.dispute.findUnique({ where: { id: req.params.id } });
    if (!dispute || dispute.userId !== req.userId) {
      return res.status(404).json({ error: "Dispute not found" });
    }
    if (!gl.isChainConfigured()) {
      return res.status(503).json({ error: "Contract not configured yet" });
    }
    const onchain = await gl.readUntilFound<{ status?: string }>(
      "get_dispute",
      [dispute.id],
      (v) => Boolean(v?.status)
    );
    if (!onchain) {
      return res.status(409).json({ error: "Dispute not found on-chain yet" });
    }
    const updated = await prisma.dispute.update({
      where: { id: dispute.id },
      data: { onchainOpened: true },
    });
    return res.json({ dispute: updated });
  }
);

// GET /api/disputes — recent disputes (public transparency), optionally
// scoped to one submission (?submissionId=) for the meme detail page.
disputesRouter.get("/", async (req, res) => {
  const submissionId = typeof req.query.submissionId === "string" ? req.query.submissionId : undefined;
  const disputes = await prisma.dispute.findMany({
    where: submissionId ? { submissionId } : undefined,
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      submission: { select: { title: true, imageUrl: true } },
      user: { select: { username: true, authAddress: true } },
    },
  });
  return res.json({
    disputes: disputes.map((d) => ({
      ...d,
      username: d.user.username || `wallet_${d.user.authAddress.slice(2, 8)}`,
    })),
  });
});
