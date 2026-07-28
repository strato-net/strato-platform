import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import { config } from "../config";
import { logError, logInfo } from "../utils/logger";

// Dashboard auth: verify the Keycloak JWT (via JWKS) and check the
// sales/marketing allowlist. This is the service's ONLY outbound dependency —
// it never talks to STRATO nodes; chain-aware authorization (e.g. on-chain
// admins) lives in the mercata backend, so dashboard users must be listed in
// TRACKING_AUTHORIZED_USERS here.

let jwksClientInstance: jwksClient.JwksClient | undefined;

export const initOpenIdConfig = async (): Promise<void> => {
  if (jwksClientInstance) return;
  if (!config.auth.openIdDiscoveryUrl) {
    throw new Error("OPENID_DISCOVERY_URL is not configured");
  }
  const response = await fetch(config.auth.openIdDiscoveryUrl);
  if (!response.ok) {
    throw new Error(`OpenID discovery failed: ${response.status}`);
  }
  const discovery = (await response.json()) as { jwks_uri?: string };
  if (!discovery.jwks_uri) {
    throw new Error("JWKS URI not found in OpenID discovery document");
  }
  jwksClientInstance = jwksClient({
    jwksUri: discovery.jwks_uri,
    cache: true,
    cacheMaxAge: 600000, // 10 minutes
  });
  logInfo("Auth", "OpenID/JWKS initialized");
};

function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) {
  if (!jwksClientInstance) {
    return callback(new Error("JWKS client not initialized"));
  }
  jwksClientInstance.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key?.getPublicKey());
  });
}

const verifyToken = (token: string): Promise<jwt.JwtPayload> =>
  new Promise((resolve, reject) => {
    jwt.verify(token, getKey, { algorithms: ["RS256"] }, (err, decoded) => {
      if (err) reject(new Error(`Token verification failed: ${err.message}`));
      else resolve(decoded as jwt.JwtPayload);
    });
  });

// Trusted X-USER-ACCESS-TOKEN comes from the app edge (openid.lua strips any
// client-supplied copy); Authorization Bearer is the local-dev/curl path.
const getTokenFromHeader = (req: Request): string | null => {
  const headerToken = req.headers["x-user-access-token"] as string | undefined;
  if (headerToken) return headerToken;
  const auth = req.headers["authorization"];
  if (typeof auth === "string") {
    const [bearer, token] = auth.split(" ");
    if (bearer === "Bearer" && token) return token;
  }
  return null;
};

export interface AuthorizedRequest extends Request {
  username?: string;
}

export const resolveAuthorization = async (
  req: Request
): Promise<{ authorized: boolean; username: string | null }> => {
  if (!jwksClientInstance) return { authorized: false, username: null };
  const token = getTokenFromHeader(req);
  if (!token) return { authorized: false, username: null };
  let payload;
  try {
    payload = await verifyToken(token);
  } catch {
    return { authorized: false, username: null };
  }
  const username = (payload.preferred_username as string | undefined)?.toLowerCase() ?? null;
  if (!username) return { authorized: false, username: null };
  return { authorized: config.auth.authorizedUsers.includes(username), username };
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
    logError("Auth", error, { operation: "requireAuthorized" });
    next(error);
  }
};
