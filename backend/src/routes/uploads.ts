/**
 * First-party image hosting.
 *
 * Memes are judged by GenLayer validators who FETCH the image URL on-chain;
 * third-party hosts (imgflip, imgur) intermittently block those fetches and
 * get good memes disqualified. Serving images from our own always-on API
 * removes that failure mode entirely.
 *
 * POST /api/uploads   (auth) — JSON { dataUrl } (data:image/...;base64,...)
 * GET  /i/:id         (public) — served with long-lived cache headers
 */
import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { limit } from "../middleware/rateLimit";

export const uploadsRouter = Router();
export const imagesRouter = Router();

const MAX_BYTES = 3 * 1024 * 1024; // 3MB
const ALLOWED = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

uploadsRouter.post(
  "/",
  requireAuth,
  limit("upload", 20, 3600),
  async (req: AuthedRequest, res: Response) => {
    const dataUrl: unknown = req.body?.dataUrl;
    if (typeof dataUrl !== "string") {
      return res.status(400).json({ error: "dataUrl required" });
    }
    const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(
      dataUrl
    );
    if (!match) {
      return res
        .status(400)
        .json({ error: "Must be a base64 data URL of PNG, JPEG, GIF or WebP" });
    }
    const [, mime, b64] = match;
    if (!ALLOWED.has(mime)) return res.status(400).json({ error: "Unsupported type" });
    const data = Buffer.from(b64, "base64");
    if (data.length < 100) return res.status(400).json({ error: "Image too small" });
    if (data.length > MAX_BYTES) {
      return res.status(413).json({ error: "Image exceeds 3MB limit" });
    }
    const image = await prisma.image.create({
      data: { userId: req.userId!, mime, data },
    });
    const base = `${req.protocol}://${req.get("host")}`;
    return res.status(201).json({ id: image.id, url: `${base}/i/${image.id}` });
  }
);

imagesRouter.get("/:id", async (req, res) => {
  const image = await prisma.image.findUnique({ where: { id: req.params.id } });
  if (!image) return res.status(404).json({ error: "Not found" });
  res.setHeader("Content-Type", image.mime);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("Access-Control-Allow-Origin", "*");
  return res.send(Buffer.from(image.data));
});
