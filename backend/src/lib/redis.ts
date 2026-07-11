/**
 * Redis (Upstash) — DELIBERATELY MINIMAL USAGE.
 *
 * Upstash bills per command, so this module is the only place Redis is
 * touched and it enforces frugality:
 *   - single lazy connection, no keyspace scans, no pub/sub, no polling
 *   - rate limiting: one INCR (+EXPIRE only on first hit) per guarded request
 *   - caching: GET on read, SET PX on write, short TTLs, few hot keys
 *   - everything degrades gracefully to "no redis" if unavailable
 */
import Redis from "ioredis";
import { config } from "./config";
import { logger } from "./logger";

let client: Redis | null = null;
let healthy = false;

export function getRedis(): Redis | null {
  if (!config.redisUrl) return null;
  if (!client) {
    client = new Redis(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (times) => Math.min(times * 5000, 60000),
    });
    client.on("ready", () => {
      healthy = true;
      logger.info("redis ready");
    });
    client.on("error", (err) => {
      if (healthy) logger.warn({ err: err.message }, "redis error");
      healthy = false;
    });
    client.connect().catch(() => {
      /* handled by retryStrategy */
    });
  }
  return client;
}

export async function cacheGet(key: string): Promise<string | null> {
  const r = getRedis();
  if (!r || r.status !== "ready") return null;
  try {
    return await r.get(key);
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: string, ttlMs: number): Promise<void> {
  const r = getRedis();
  if (!r || r.status !== "ready") return;
  try {
    await r.set(key, value, "PX", ttlMs);
  } catch {
    /* cache is best-effort */
  }
}

/**
 * Sliding-window-ish rate limit using a single INCR per request.
 * Returns true when the request is allowed.
 */
export async function rateLimit(
  key: string,
  max: number,
  windowSeconds: number
): Promise<boolean> {
  const r = getRedis();
  if (!r || r.status !== "ready") return true; // fail-open, don't block users
  try {
    const bucket = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;
    const count = await r.incr(bucket);
    if (count === 1) await r.expire(bucket, windowSeconds + 1);
    return count <= max;
  } catch {
    return true;
  }
}
