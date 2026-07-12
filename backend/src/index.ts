import express from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { config } from "./lib/config";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { authRouter } from "./routes/auth";
import { competitionsRouter } from "./routes/competitions";
import { submissionsRouter } from "./routes/submissions";
import { disputesRouter } from "./routes/disputes";
import { rewardsRouter } from "./routes/rewards";
import { adminRouter } from "./routes/admin";
import { uploadsRouter, imagesRouter } from "./routes/uploads";
import { startSchedulers, runWeeklyRollover } from "./jobs/weekly";

const app = express();

app.set("trust proxy", 1); // Fly proxy: correct req.protocol (https) and req.ip

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(
  cors({
    origin: [config.frontendUrl, /\.vercel\.app$/],
    credentials: false,
  })
);
app.use(express.json({ limit: "6mb" })); // base64 image uploads
app.use(
  pinoHttp({
    logger,
    autoLogging: { ignore: (req) => req.url === "/health" },
  })
);

// Health check — used by Fly to keep the machine alive 24/7.
app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, uptime: process.uptime() });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.use("/api/auth", authRouter);
app.use("/api/competitions", competitionsRouter);
app.use("/api/submissions", submissionsRouter);
app.use("/api/disputes", disputesRouter);
app.use("/api/rewards", rewardsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/uploads", uploadsRouter);
app.use("/i", imagesRouter);

// Public showcase: the current top judged meme — used by the landing page's
// live "see how it was judged" link.
app.get("/api/showcase", async (_req, res) => {
  const top = await prisma.submission.findFirst({
    where: { status: { in: ["winner", "evaluated"] } },
    orderBy: [{ status: "desc" }, { totalScore: "desc" }],
    select: { id: true, title: true, totalScore: true },
  });
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.json({ showcase: top });
});

// Central error handler — never leak internals.
app.use(
  (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err: err.message, stack: err.stack }, "unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
);

// Resilience: log, never die. Fly restarts us if the process truly exits.
process.on("unhandledRejection", (reason) => {
  logger.error({ reason: String(reason) }, "unhandledRejection");
});
process.on("uncaughtException", (err) => {
  logger.error({ err: err.message, stack: err.stack }, "uncaughtException");
});

app.listen(config.port, "0.0.0.0", () => {
  logger.info({ port: config.port }, "Meme Olympics API listening");
  startSchedulers();
  // Ensure a competition exists on boot (idempotent).
  runWeeklyRollover().catch((e) =>
    logger.error({ err: e.message }, "boot rollover failed")
  );
});
