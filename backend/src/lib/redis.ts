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
 * Distributed lock for cron ticks — this app intentionally runs multiple
 * Fly machines for 24/7 uptime, and each one independently fires the same
 * node-cron schedule. Without this, every tick (close/judge/relay sweeps)
 * executes once PER MACHINE, double-triggering on-chain writes. Only the
 * machine that wins the SET NX runs the tick; it self-expires via TTL so a
 * crashed holder can't wedge the lock forever. Fails "locked" (i.e. skip)
 * when Redis is unavailable — safer to occasionally miss a tick (the next
 * one 1-2 minutes later catches up) than to silently go back to
 * double-triggering when Redis blips.
 */
async function acquireLock(key: string, ttlMs: number): Promise<boolean> {
  const r = getRedis();
  if (!r || r.status !== "ready") return false;
  try {
    const ok = await r.set(`lock:${key}`, "1", "PX", ttlMs, "NX");
    return ok === "OK";
  } catch {
    return false;
  }
}

/**
 * Runs `fn` only if this machine wins the lock; otherwise resolves to
 * undefined without calling `fn` at all (some other machine already has
 * it). The lock is renewed (PEXPIRE) at half the TTL for as long as `fn`
 * is running, so a job that legitimately takes minutes — judging sweeps
 * wait on-chain per submission — never has its lock expire out from under
 * it and let a second machine start a conflicting run. Released
 * immediately on completion rather than waiting out the TTL.
 */
export async function withLock<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>
): Promise<T | undefined> {
  if (!(await acquireLock(key, ttlMs))) return undefined;
  const r = getRedis();
  const renew = setInterval(() => {
    r?.pexpire(`lock:${key}`, ttlMs).catch(() => undefined);
  }, Math.max(1000, Math.floor(ttlMs / 2)));
  try {
    return await fn();
  } finally {
    clearInterval(renew);
    r?.del(`lock:${key}`).catch(() => undefined);
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
