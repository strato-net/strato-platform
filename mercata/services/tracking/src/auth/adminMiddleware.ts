import { NextFunction, Request, Response } from "express";
import { config } from "../config";
import { logError } from "../utils/logger";
import { normalizeAddress } from "../utils/addresses";
import { getTokenFromHeader, getUserKey, isAuthInitialized, verifyAccessTokenSignature } from "./index";
import { isOnChainAdmin } from "../services/cirrusService";

export interface AuthorizedRequest extends Request {
  username?: string;
}

interface CachedDecision {
  authorized: boolean;
  expiresAt: number;
}

const DECISION_TTL_MS = 5 * 60 * 1000;
const decisionCache = new Map<string, CachedDecision>();

// Authorized = username on the sales/marketing allowlist, OR on-chain admin
// per the AdminRegistry (same rule the marketplace backend uses).
export const resolveAuthorization = async (
  req: Request
): Promise<{ authorized: boolean; username: string | null }> => {
  if (!isAuthInitialized()) return { authorized: false, username: null };
  const token = getTokenFromHeader(req);
  if (!token) return { authorized: false, username: null };

  let payload;
  try {
    payload = await verifyAccessTokenSignature(token);
  } catch {
    return { authorized: false, username: null };
  }
  const username = (payload.preferred_username as string | undefined)?.toLowerCase() ?? null;
  if (!username) return { authorized: false, username: null };

  if (config.auth.authorizedUsers.includes(username)) {
    return { authorized: true, username };
  }

  const cached = decisionCache.get(username);
  if (cached && cached.expiresAt > Date.now()) {
    return { authorized: cached.authorized, username };
  }

  let authorized = false;
  try {
    const address = normalizeAddress(await getUserKey(token));
    if (address) authorized = await isOnChainAdmin(address);
  } catch (error) {
    logError("Auth", error, { operation: "onChainAdminCheck", username });
  }
  decisionCache.set(username, { authorized, expiresAt: Date.now() + DECISION_TTL_MS });
  return { authorized, username };
};

export const requireAuthorized = async (
  req: AuthorizedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { authorized, username } = await resolveAuthorization(req);
    if (!authorized) {
      res.status(username ? 403 : 401).json({ error: "Not authorized" });
      return;
    }
    req.username = username ?? undefined;
    next();
  } catch (error) {
    next(error);
  }
};
