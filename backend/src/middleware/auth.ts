import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../lib/config";
import { prisma } from "../lib/prisma";

export interface AuthedRequest extends Request {
  userId?: string;
  userRole?: string;
}

export function signToken(userId: string, role: string): string {
  return jwt.sign({ sub: userId, role }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  } as jwt.SignOptions);
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    const payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    req.userId = String(payload.sub);
    req.userRole = String(payload.role || "user");
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export async function requireAdmin(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
) {
  if (req.userRole === "admin") return next();
  // Re-check DB in case role changed after token issuance
  const user = req.userId
    ? await prisma.user.findUnique({ where: { id: req.userId } })
    : null;
  if (user?.role === "admin") return next();
  return res.status(403).json({ error: "Admin access required" });
}
