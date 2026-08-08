import { Router, Response } from "express";
import { verifyMessage, getAddress, isAddress } from "ethers";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { signToken, requireAuth, AuthedRequest } from "../middleware/auth";
import { limit } from "../middleware/rateLimit";
import { cacheGet, cacheSet } from "../lib/redis";
import { config } from "../lib/config";
import { logger } from "../lib/logger";

export const authRouter = Router();

const NONCE_TTL_MS = 5 * 60 * 1000;

function nonceKey(address: string): string {
  return `siwe:${address.toLowerCase()}`;
}

function buildMessage(address: string, nonce: string, issuedAt: string): string {
  return [
    "Sign in to Meme Olympics.",
    "",
    "This only proves you own this wallet — it is not a transaction and",
    "costs no gas.",
    "",
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

function publicUser(u: {
  id: string;
  authAddress: string;
  username: string | null;
  role: string;
  createdAt: Date;
}) {
  return {
    id: u.id,
    authAddress: u.authAddress,
    username: u.username,
    role: u.role,
    createdAt: u.createdAt,
  };
}

// GET /api/auth/nonce?address=0x... — issues a one-time message for the
// wallet to sign. No account is created yet; that only happens once the
// signature is verified in POST /wallet-login.
authRouter.get("/nonce", limit("nonce", 20, 300), async (req, res) => {
  const address = String(req.query.address || "");
  if (!isAddress(address)) {
    return res.status(400).json({ error: "Invalid wallet address" });
  }
  const checksummed = getAddress(address);
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const issuedAt = new Date().toISOString();
  const message = buildMessage(checksummed, nonce, issuedAt);
  await cacheSet(nonceKey(checksummed), message, NONCE_TTL_MS);
  return res.json({ message });
});

// POST /api/auth/wallet-login — verifies the signed nonce message and signs
// the caller in, creating an account on first connect. The connected
// wallet is the ONLY key in this app: it signs the login message, every
// GenLayer write (see frontend/src/lib/genlayer.ts), and every Base
// Sepolia transaction. No custodial key is ever generated.
authRouter.post(
  "/wallet-login",
  limit("wallet-login", 20, 300),
  async (req, res) => {
    const schema = z.object({
      address: z.string(),
      signature: z.string(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid payload" });
    }
    if (!isAddress(parsed.data.address)) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }
    const address = getAddress(parsed.data.address);

    const message = await cacheGet(nonceKey(address));
    if (!message) {
      return res.status(400).json({
        error: "Login request expired or was never issued — request a fresh nonce",
      });
    }
    // Single-use: consume immediately so a captured signature can't be
    // replayed even within the TTL window.
    await cacheSet(nonceKey(address), "", 1);

    let recovered: string;
    try {
      recovered = verifyMessage(message, parsed.data.signature);
    } catch {
      return res.status(401).json({ error: "Invalid signature" });
    }
    if (getAddress(recovered) !== address) {
      return res.status(401).json({ error: "Signature does not match wallet address" });
    }

    let user = await prisma.user.findUnique({ where: { authAddress: address } });
    // Re-derived on EVERY login, not just first registration — adding or
    // removing a wallet from ADMIN_WALLETS now takes effect the next time
    // that wallet logs in, instead of requiring a manual DB promotion.
    const shouldBeAdmin = config.adminWallets.includes(address.toLowerCase());
    if (!user) {
      user = await prisma.user.create({
        data: { authAddress: address, role: shouldBeAdmin ? "admin" : "user" },
      });
      logger.info({ userId: user.id, authAddress: address }, "wallet account created");
    } else {
      const role = shouldBeAdmin ? "admin" : "user";
      if (user.role !== role) {
        user = await prisma.user.update({ where: { id: user.id }, data: { role } });
        logger.info({ userId: user.id, authAddress: address, role }, "wallet role synced from ADMIN_WALLETS");
      }
    }

    return res.json({ token: signToken(user.id, user.role), user: publicUser(user) });
  }
);

// GET /api/auth/me
authRouter.get("/me", requireAuth, async (req: AuthedRequest, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json({ user: publicUser(user) });
});

const usernameSchema = z
  .string()
  .min(3)
  .max(24)
  .regex(/^[a-zA-Z0-9_]+$/, "Username: letters, numbers, underscore only");

// PATCH /api/auth/me — set a display name for your connected wallet. Purely
// cosmetic (shown on leaderboards/submissions/dashboard instead of a
// shortened address) — never used for login, which stays wallet-only.
authRouter.patch(
  "/me",
  requireAuth,
  limit("set-username", 10, 3600),
  async (req: AuthedRequest, res: Response) => {
    const schema = z.object({ username: usernameSchema });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const existing = await prisma.user.findUnique({
      where: { username: parsed.data.username },
    });
    if (existing && existing.id !== req.userId) {
      return res.status(409).json({ error: "Username already taken" });
    }
    const user = await prisma.user.update({
      where: { id: req.userId! },
      data: { username: parsed.data.username },
    });
    return res.json({ user: publicUser(user) });
  }
);
