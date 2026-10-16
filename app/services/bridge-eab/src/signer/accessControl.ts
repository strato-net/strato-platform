import { createHash, timingSafeEqual } from "crypto";
import type { RequestHandler } from "express";
import { getAddress, verifyTypedData } from "ethers";
import {
  MIN_SERVICE_TOKEN_LENGTH,
  VERIFIER_ACCESS_CLOCK_TOLERANCE_SECONDS,
  VERIFIER_ACCESS_DOMAIN,
  VERIFIER_ACCESS_TOKEN_TTL_SECONDS,
  VERIFIER_ACCESS_TYPES,
  VERIFIER_AUTH_ATTEMPTS_PER_MINUTE,
  VERIFIER_RATE_LIMIT_MAX_CLIENTS,
  VERIFIER_REQUESTS_PER_MINUTE,
  decodeVerifierAccessToken,
  normalizeVerifierUrl,
} from "../config/verifierAccess";

// Signed access for a verifier: tokens from the runtime access address, for this verifier's URL and chain.
export interface SignedVerifierAccess {
  runtimeAccessAddress: string;
  verifierUrl: string;
  chainId: bigint;
}

// A verifier accepts the legacy bearer token, signed access, or both while a deployment moves to signed access.
export interface VerifierAccessOptions {
  token?: string;
  signed?: SignedVerifierAccess;
}

export const verifySignedVerifierAccess = (
  authorization: string,
  signed: SignedVerifierAccess,
  nowMs: number,
): boolean => {
  if (!authorization.startsWith("Bearer ")) return false;
  const decoded = decodeVerifierAccessToken(authorization.slice("Bearer ".length));
  if (!decoded) return false;
  const { grant, signature } = decoded;
  const now = Math.floor(nowMs / 1000);
  if (grant.verifier !== signed.verifierUrl || BigInt(grant.chainId) !== signed.chainId) return false;
  if (grant.expiresAt < now - VERIFIER_ACCESS_CLOCK_TOLERANCE_SECONDS) return false;
  if (grant.expiresAt > now + VERIFIER_ACCESS_TOKEN_TTL_SECONDS + VERIFIER_ACCESS_CLOCK_TOLERANCE_SECONDS) return false;
  try {
    return verifyTypedData(VERIFIER_ACCESS_DOMAIN, VERIFIER_ACCESS_TYPES, grant, signature).toLowerCase() ===
      signed.runtimeAccessAddress.toLowerCase();
  } catch {
    return false;
  }
};

export const verifierAccessControl = (access: string | undefined | VerifierAccessOptions, now = Date.now): RequestHandler => {
  const token = (typeof access === "object" ? access.token : access) || undefined;
  const signed = typeof access === "object" ? access.signed : undefined;
  if (!token && !signed) return (_req, res) => { res.status(503).json({ error: "Authentication is not configured" }); };
  if (token !== undefined && token.length < MIN_SERVICE_TOKEN_LENGTH) throw new Error(`Bearer tokens must contain at least ${MIN_SERVICE_TOKEN_LENGTH} characters`);
  const expected = token ? createHash("sha256").update(`Bearer ${token}`).digest() : undefined;
  const audience = signed && {
    runtimeAccessAddress: getAddress(signed.runtimeAccessAddress),
    verifierUrl: normalizeVerifierUrl(signed.verifierUrl),
    chainId: signed.chainId,
  };
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
    const authorization = req.headers.authorization || "";
    const tokenMatches = expected !== undefined &&
      timingSafeEqual(createHash("sha256").update(authorization).digest(), expected);
    if (!tokenMatches && !(audience && verifySignedVerifierAccess(authorization, audience, now()))) {
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
