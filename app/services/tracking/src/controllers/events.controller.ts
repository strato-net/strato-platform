import { Request, Response } from "express";
import { config } from "../config";
import {
  findSessionByRecentIp,
  isValidSessionId,
  markEngaged,
  recordWalletConnection,
} from "../services/sessionService";
import { normalizeAddress } from "../utils/addresses";
import { isPublicIp, normalizeIp } from "../utils/geo";
import { logError } from "../utils/logger";

// How the beacon found its session — persisted on the wallet connection so a
// zero-attribution report can be traced back to the transport that failed.
type SessionSource = "cookie" | "header" | "query" | "ip";

const sessionFromCookie = (req: Request): string | null => {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === config.tracking.cookieName) {
      const value = rest.join("=");
      return isValidSessionId(value) ? value : null;
    }
  }
  return null;
};

const firstString = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return null;
};

// The cookie is the primary carrier, but it is lost whenever the destination
// lives on another host or the browser drops it (in-app webviews, ITP). The
// resolver therefore also puts the session id in the redirect URL, and the app
// echoes it back as ?stid= or X-Strato-Tid.
const sessionFromRequest = (req: Request): { sessionId: string; source: SessionSource } | null => {
  const cookie = sessionFromCookie(req);
  if (cookie) return { sessionId: cookie, source: "cookie" };
  const header = firstString(req.headers["x-strato-tid"]);
  if (isValidSessionId(header)) return { sessionId: header, source: "header" };
  const queryValue = firstString(req.query?.stid);
  if (isValidSessionId(queryValue)) return { sessionId: queryValue, source: "query" };
  const bodyValue = firstString(req.body?.stid);
  if (isValidSessionId(bodyValue)) return { sessionId: bodyValue, source: "query" };
  return null;
};

// Both beacons answer 204 unconditionally: they must never leak whether a
// session exists, and a failed beacon must never surface in the app.

// POST /tracking-api/engage
export const engage = async (req: Request, res: Response): Promise<void> => {
  const session = sessionFromRequest(req);
  if (session) {
    try {
      await markEngaged(session.sessionId);
    } catch (error) {
      logError("Events", error, { operation: "engage" });
    }
  }
  res.status(204).end();
};

// POST /tracking-api/wallet-connected
export const walletConnected = async (req: Request, res: Response): Promise<void> => {
  const externalWalletAddress = normalizeAddress(req.body?.externalWalletAddress);
  const stratoAddress = normalizeAddress(req.body?.stratoAddress);
  if (!externalWalletAddress && !stratoAddress) {
    res.status(204).end();
    return;
  }
  const connector =
    typeof req.body?.connector === "string" ? req.body.connector.slice(0, 64) : null;

  try {
    let session = sessionFromRequest(req);
    if (!session) {
      // No session id at all: fall back to this visitor's own recent open
      // from the same public IP (guarded in findSessionByRecentIp).
      const ip = normalizeIp(req.ip);
      const sessionId = isPublicIp(ip)
        ? await findSessionByRecentIp(ip, config.tracking.ipFallbackMinutes)
        : null;
      session = sessionId ? { sessionId, source: "ip" } : null;
    }
    if (session) {
      await recordWalletConnection(
        session.sessionId,
        externalWalletAddress,
        stratoAddress,
        connector,
        session.source
      );
    }
  } catch (error) {
    logError("Events", error, { operation: "walletConnected" });
  }
  res.status(204).end();
};
