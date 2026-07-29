import { Request, Response } from "express";
import { config } from "../config";
import { isValidSessionId, markEngaged, recordWalletConnection } from "../services/sessionService";
import { normalizeAddress } from "../utils/addresses";
import { logError } from "../utils/logger";

// Both beacons answer 204 unconditionally: they must never leak whether a
// session exists, and a failed beacon must never surface in the app.
const getSessionId = (req: Request): string | null => {
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

// POST /tracking-api/engage
export const engage = async (req: Request, res: Response): Promise<void> => {
  const sessionId = getSessionId(req);
  if (sessionId) {
    try {
      await markEngaged(sessionId);
    } catch (error) {
      logError("Events", error, { operation: "engage" });
    }
  }
  res.status(204).end();
};

// POST /tracking-api/wallet-connected
export const walletConnected = async (req: Request, res: Response): Promise<void> => {
  const sessionId = getSessionId(req);
  if (sessionId) {
    const externalWalletAddress = normalizeAddress(req.body?.externalWalletAddress);
    const stratoAddress = normalizeAddress(req.body?.stratoAddress);
    const connector =
      typeof req.body?.connector === "string" ? req.body.connector.slice(0, 64) : null;
    if (externalWalletAddress || stratoAddress) {
      try {
        await recordWalletConnection(sessionId, externalWalletAddress, stratoAddress, connector);
      } catch (error) {
        logError("Events", error, { operation: "walletConnected" });
      }
    }
  }
  res.status(204).end();
};
