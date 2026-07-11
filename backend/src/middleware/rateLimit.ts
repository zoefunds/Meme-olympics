import { Response, NextFunction } from "express";
import { rateLimit } from "../lib/redis";
import { AuthedRequest } from "./auth";

/**
 * Redis-frugal rate limiter: one INCR per request, applied only to
 * sensitive routes (auth + submissions), never to public reads.
 */
export function limit(name: string, max: number, windowSeconds: number) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const who = req.userId || req.ip || "anon";
    const ok = await rateLimit(`${name}:${who}`, max, windowSeconds);
    if (!ok) {
      return res
        .status(429)
        .json({ error: "Too many requests. Please slow down." });
    }
    next();
  };
}
