import { Router, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { limit } from "../middleware/rateLimit";
import * as gl from "../services/genlayer";

export const submissionsRouter = Router();

const submitSchema = z.object({
  competitionId: z.string().min(3).max(64),
  title: z.string().min(1).max(120),
  caption: z.string().max(600).default(""),
  imageUrl: z.string().url().max(500),
  contextUrl: z.string().url().max(500).optional().or(z.literal("")),
  tags: z.array(z.string().min(1).max(32)).max(8).default([]),
});

// POST /api/submissions — registers the meme in our own DB. The actual
// on-chain submit_meme call is signed and sent by the CALLER'S OWN wallet
// from the frontend (see lib/genlayer.ts) — this backend never holds a
// private key for any user, so it can't sign on their behalf. Call
// POST /:id/onchain-confirm once that transaction lands.
submissionsRouter.post(
  "/",
  requireAuth,
  limit("submit", 12, 3600),
  async (req: AuthedRequest, res: Response) => {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const data = parsed.data;

    const comp = await prisma.competition.findUnique({
      where: { id: data.competitionId },
    });
    // Deadline is enforced here too, not just by the close scheduler — a
    // submission must never be accepted after endsAt even in the narrow
    // window before that arena's close timer has actually fired.
    if (!comp || comp.status !== "open" || comp.endsAt <= new Date()) {
      return res.status(400).json({ error: "Competition is not open" });
    }

    const mine = await prisma.submission.count({
      where: { competitionId: comp.id, userId: req.userId! },
    });
    if (mine >= 1) {
      return res
        .status(400)
        .json({ error: "You already submitted to this arena" });
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

    return res.status(201).json({ submission: sub });
  }
);

// POST /api/submissions/:id/onchain-confirm — called by the frontend once
// its own wallet-signed submit_meme transaction lands. We don't just trust
// the client's word for it: read the submission back from GenLayer and
// only flip status once it's actually there.
submissionsRouter.post(
  "/:id/onchain-confirm",
  requireAuth,
  async (req: AuthedRequest, res: Response) => {
    const sub = await prisma.submission.findUnique({ where: { id: req.params.id } });
    if (!sub || sub.userId !== req.userId) {
      return res.status(404).json({ error: "Submission not found" });
    }
    const schema = z.object({ txHash: z.string().min(4) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "txHash required" });

    if (!gl.isChainConfigured()) {
      return res.status(503).json({ error: "Contract not configured yet" });
    }
    const onchain = await gl.readUntilFound<{ status?: string }>(
      "get_submission",
      [sub.id],
      (v) => Boolean(v?.status)
    );
    if (!onchain) {
      return res.status(409).json({ error: "Submission not found on-chain yet" });
    }
    const updated = await prisma.submission.update({
      where: { id: sub.id },
      data: { status: "onchain", onchainTxHash: parsed.data.txHash },
    });
    return res.json({ submission: updated });
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
