/**
 * Transactional email via Brevo REST API (no SDK dependency).
 * Used for: password reset, submission results, winner notifications.
 */
import { config } from "../lib/config";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!config.brevo.apiKey || !config.brevo.senderEmail) {
    logger.warn("brevo not configured; skipping email");
    return false;
  }
  try {
    const res = await fetch(BREVO_URL, {
      method: "POST",
      headers: {
        "api-key": config.brevo.apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: { email: config.brevo.senderEmail, name: config.brevo.senderName },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, body: await res.text() }, "brevo send failed");
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "brevo send error");
    return false;
  }
}

function shell(title: string, body: string): string {
  return `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#0d1117;color:#e6edf3;border-radius:12px">
  <h2 style="color:#f7c948;margin-top:0">🏆 Meme Olympics</h2>
  <h3 style="margin:0 0 12px">${title}</h3>
  <div style="line-height:1.6;font-size:15px">${body}</div>
  <p style="color:#8b949e;font-size:12px;margin-top:24px">AI-judged weekly crypto meme competitions, settled by GenLayer validator consensus.</p>
</div>`;
}

async function logNotification(userId: string, type: string, subject: string, ok: boolean) {
  try {
    await prisma.notificationLog.create({
      data: { userId, type, subject, status: ok ? "sent" : "failed" },
    });
  } catch {
    /* non-fatal */
  }
}

export async function sendPasswordResetEmail(
  userId: string,
  to: string,
  token: string
): Promise<void> {
  const link = `${config.frontendUrl}/reset-password?token=${token}`;
  const ok = await sendEmail(
    to,
    "Reset your Meme Olympics password",
    shell(
      "Password reset requested",
      `<p>Click the button below to choose a new password. This link expires in 30 minutes.</p>
       <p><a href="${link}" style="display:inline-block;background:#f7c948;color:#0d1117;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Reset password</a></p>
       <p>If you didn't request this, you can safely ignore this email.</p>`
    )
  );
  await logNotification(userId, "password_reset", "Password reset", ok);
}

export async function sendWelcomeEmail(
  userId: string,
  to: string,
  username: string,
  walletAddress: string
): Promise<void> {
  const ok = await sendEmail(
    to,
    "Welcome to Meme Olympics 🏆",
    shell(
      `Welcome, ${username}!`,
      `<p>Your account is ready and a GenLayer wallet has been created for you:</p>
       <p style="font-family:monospace;background:#161b22;padding:10px;border-radius:6px;word-break:break-all">${walletAddress}</p>
       <p>This wallet is permanently linked to your account — it survives device changes and reinstalls. You can export your private key anytime from Settings.</p>
       <p><a href="${config.frontendUrl}/submit" style="color:#f7c948">Submit your first meme →</a></p>`
    )
  );
  await logNotification(userId, "welcome", "Welcome", ok);
}

export async function sendEvaluationEmail(
  userId: string,
  to: string,
  memeTitle: string,
  score: number,
  verdict: string,
  summary: string
): Promise<void> {
  const ok = await sendEmail(
    to,
    `Your meme "${memeTitle}" was judged — ${score}/100`,
    shell(
      "Validator consensus reached",
      `<p>GenLayer validators reached consensus on your submission <b>${memeTitle}</b>.</p>
       <p><b>Score:</b> ${score}/100<br/><b>Originality verdict:</b> ${verdict}</p>
       <p><i>${summary}</i></p>
       <p><a href="${config.frontendUrl}/dashboard" style="color:#f7c948">View details →</a></p>`
    )
  );
  await logNotification(userId, "evaluation", "Meme judged", ok);
}

export async function sendWinnerEmail(
  userId: string,
  to: string,
  memeTitle: string,
  rank: number,
  rewardPoints: string
): Promise<void> {
  const medals = ["🥇", "🥈", "🥉"];
  const medal = medals[rank - 1] || "🏅";
  const ok = await sendEmail(
    to,
    `${medal} You won rank #${rank} in Meme Olympics!`,
    shell(
      `${medal} Winner — Rank #${rank}`,
      `<p>Your meme <b>${memeTitle}</b> placed <b>#${rank}</b> this week, as judged by GenLayer validator consensus.</p>
       <p><b>Reward:</b> ${rewardPoints} points</p>
       <p><a href="${config.frontendUrl}/rewards" style="color:#f7c948">View your rewards →</a></p>`
    )
  );
  await logNotification(userId, "winner", `Winner rank ${rank}`, ok);
}
