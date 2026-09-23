import { createHash, timingSafeEqual } from "crypto";
import type { RequestHandler } from "express";
import { MIN_SERVICE_TOKEN_LENGTH, VERIFIER_REQUESTS_PER_MINUTE, VERIFIER_AUTH_ATTEMPTS_PER_MINUTE, VERIFIER_RATE_LIMIT_MAX_CLIENTS } from "../config/verifierAccess";

export const verifierAccessControl = (token: string | undefined, now = Date.now): RequestHandler => {
  if (!token) return (_req, res) => { res.status(503).json({ error: "Authentication is not configured" }); };
  if (token.length < MIN_SERVICE_TOKEN_LENGTH) throw new Error(`Bearer tokens must contain at least ${MIN_SERVICE_TOKEN_LENGTH} characters`);
  const expected = createHash("sha256").update(`Bearer ${token}`).digest();
  const attempts = new Map<string, number>();
  let windowStart = now();
  let accepted = 0;
  return (req, res, next) => {
    if (now() - windowStart >= 60_000) {
      attempts.clear();
      accepted = 0;
      windowStart = now();
    }
    const limited = () => { res.setHeader("Retry-After", "60"); res.status(429).json({ error: "Rate limit exceeded" }); };
    const supplied = createHash("sha256").update(req.headers.authorization || "").digest();
    if (!timingSafeEqual(supplied, expected)) {
      const client = req.socket.remoteAddress || "unknown";
      const count = attempts.get(client) || 0;
      if (count >= VERIFIER_AUTH_ATTEMPTS_PER_MINUTE || (!attempts.has(client) && attempts.size >= VERIFIER_RATE_LIMIT_MAX_CLIENTS)) {
        limited(); return;
      }
      attempts.set(client, count + 1);
      res.status(401).json({ error: "Unauthorized" }); return;
    }
    if (accepted >= VERIFIER_REQUESTS_PER_MINUTE) { limited(); return; }
    accepted++;
    next();
  };
};
