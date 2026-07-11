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
import { startSchedulers, runWeeklyRollover } from "./jobs/weekly";

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: [config.frontendUrl, /\.vercel\.app$/],
    credentials: false,
  })
);
app.use(express.json({ limit: "256kb" }));
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
