import { Router, Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { Wallet } from "ethers";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { encryptPrivateKey, decryptPrivateKey } from "../lib/walletCrypto";
import { signToken, requireAuth, AuthedRequest } from "../middleware/auth";
import { limit } from "../middleware/rateLimit";
import { sendPasswordResetEmail, sendWelcomeEmail } from "../services/email";
import { config } from "../lib/config";
import { logger } from "../lib/logger";

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email().max(200),
  username: z
    .string()
    .min(3)
    .max(24)
    .regex(/^[a-zA-Z0-9_]+$/, "Username: letters, numbers, underscore only"),
  password: z.string().min(8).max(128),
});

function publicUser(u: {
  id: string;
  email: string;
  username: string;
  walletAddress: string;
  role: string;
  createdAt: Date;
}) {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    walletAddress: u.walletAddress,
    role: u.role,
    createdAt: u.createdAt,
  };
}

// POST /api/auth/register — creates account + permanent custodial wallet
authRouter.post("/register", limit("register", 5, 3600), async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { email, username, password } = parsed.data;

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: email.toLowerCase() }, { username }] },
  });
  if (existing) {
    return res.status(409).json({ error: "Email or username already in use" });
  }

  // Blockchain wallet created at registration — permanently linked to the
  // account row, so it survives devices, browsers, and reinstalls.
  const wallet = Wallet.createRandom();
  const passwordHash = await bcrypt.hash(password, 12);
  const role = config.adminEmails.includes(email.toLowerCase()) ? "admin" : "user";

  const user = await prisma.user.create({
    data: {
      email: email.toLowerCase(),
      username,
      passwordHash,
      walletAddress: wallet.address,
      encryptedPrivateKey: encryptPrivateKey(wallet.privateKey),
      role,
    },
  });

  sendWelcomeEmail(user.id, user.email, user.username, user.walletAddress).catch(
    (e) => logger.warn({ err: e.message }, "welcome email failed")
  );

  return res.status(201).json({
    token: signToken(user.id, user.role),
    user: publicUser(user),
  });
});

// POST /api/auth/login
authRouter.post("/login", limit("login", 10, 900), async (req, res) => {
  const schema = z.object({ email: z.string().email(), password: z.string() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
  });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  return res.json({ token: signToken(user.id, user.role), user: publicUser(user) });
});

// POST /api/auth/forgot-password — Brevo email with 30-min token
authRouter.post(
  "/forgot-password",
  limit("forgot", 3, 3600),
  async (req, res) => {
    const schema = z.object({ email: z.string().email() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid email" });

    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email.toLowerCase() },
    });
    // Always answer 200 to avoid account enumeration.
    if (user) {
      const token = crypto.randomBytes(32).toString("hex");
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        },
      });
      sendPasswordResetEmail(user.id, user.email, token).catch((e) =>
        logger.warn({ err: e.message }, "reset email failed")
      );
    }
    return res.json({ ok: true, message: "If that email exists, a reset link was sent." });
  }
);

// POST /api/auth/reset-password
authRouter.post("/reset-password", limit("reset", 5, 3600), async (req, res) => {
  const schema = z.object({
    token: z.string().min(32),
    password: z.string().min(8).max(128),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

  const tokenHash = crypto
    .createHash("sha256")
    .update(parsed.data.token)
    .digest("hex");
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
  });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return res.status(400).json({ error: "Invalid or expired reset link" });
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash: await bcrypt.hash(parsed.data.password, 12) },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
  ]);
  return res.json({ ok: true, message: "Password updated. You can now sign in." });
});

// GET /api/auth/me
authRouter.get("/me", requireAuth, async (req: AuthedRequest, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json({ user: publicUser(user) });
});

// POST /api/auth/export-key — secure private key export (password re-check)
authRouter.post(
  "/export-key",
  requireAuth,
  limit("export", 3, 3600),
  async (req: AuthedRequest, res: Response) => {
    const schema = z.object({ password: z.string() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Password required" });

    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      return res.status(401).json({ error: "Incorrect password" });
    }
    return res.json({
      walletAddress: user.walletAddress,
      privateKey: decryptPrivateKey(user.encryptedPrivateKey),
      warning:
        "Never share this key. Anyone holding it fully controls your wallet.",
    });
  }
);
