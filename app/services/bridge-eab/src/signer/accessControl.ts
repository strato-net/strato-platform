import { createHash, timingSafeEqual } from "crypto";
import type { RequestHandler } from "express";
import { getAddress, isAddress, verifyTypedData } from "ethers";
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

// The verifier's access configuration: RUNTIME_ACCESS_ADDRESS (the runtime's access key address) and
// VERIFIER_PUBLIC_URL (the verifier's own public URL, the audience of every token). Both are required.
export const signedVerifierAccessFromEnv = (
  env: NodeJS.ProcessEnv,
  chainId: bigint,
  warn: (message: string) => void = console.warn,
): SignedVerifierAccess => {
  const address = env.RUNTIME_ACCESS_ADDRESS?.trim();
  if (!address) throw new Error("RUNTIME_ACCESS_ADDRESS is required: the address of the runtime's access key");
  if (!isAddress(address)) throw new Error("RUNTIME_ACCESS_ADDRESS must be a valid address");
  const url = env.VERIFIER_PUBLIC_URL?.trim();
  if (!url) throw new Error("VERIFIER_PUBLIC_URL is required: this verifier's public URL, as the runtime calls it");
  let verifierUrl: string;
  try {
    verifierUrl = normalizeVerifierUrl(url);
  } catch (error) {
    throw new Error(`VERIFIER_PUBLIC_URL must be this verifier's public https URL: ${(error as Error).message}`);
  }
  if (env.EXTERNAL_BRIDGE_VERIFIER_API_TOKEN?.trim()) {
    warn("EXTERNAL_BRIDGE_VERIFIER_API_TOKEN is ignored: the verifier accepts only signed access from RUNTIME_ACCESS_ADDRESS. Remove it from the environment.");
  }
  return { runtimeAccessAddress: getAddress(address), verifierUrl, chainId };
};

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

// Bounds authenticated requests and failed attempts per client around an authorization check.
const rateLimitedAccess = (authorized: (authorization: string) => boolean, now: () => number): RequestHandler => {
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
    if (!authorized(req.headers.authorization || "")) {
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

// A verifier accepts only signed access: an eab-access-v1 token from the runtime access address for its own URL and chain.
export const verifierAccessControl = (signed: SignedVerifierAccess, now = Date.now): RequestHandler => {
  const audience = {
    runtimeAccessAddress: getAddress(signed.runtimeAccessAddress),
    verifierUrl: normalizeVerifierUrl(signed.verifierUrl),
    chainId: signed.chainId,
  };
  return rateLimitedAccess((authorization) => verifySignedVerifierAccess(authorization, audience, now()), now);
};

// The runtime's own webhook and operations endpoints: one static bearer token each (DEPOSIT_WEBHOOK_TOKEN,
// DEPOSIT_OPERATIONS_TOKEN). Not used between the runtime and the verifiers.
export const serviceTokenAccessControl = (token: string | undefined, now = Date.now): RequestHandler => {
  if (!token) return (_req, res) => { res.status(503).json({ error: "Authentication is not configured" }); };
  if (token.length < MIN_SERVICE_TOKEN_LENGTH) throw new Error(`Bearer tokens must contain at least ${MIN_SERVICE_TOKEN_LENGTH} characters`);
  const expected = createHash("sha256").update(`Bearer ${token}`).digest();
  return rateLimitedAccess(
    (authorization) => timingSafeEqual(createHash("sha256").update(authorization).digest(), expected),
    now,
  );
};
