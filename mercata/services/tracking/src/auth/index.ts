import { Request } from "express";
import axios from "axios";
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import { config } from "../config";
import { logError, logInfo } from "../utils/logger";

let jwksClientInstance: jwksClient.JwksClient | undefined;

export const initOpenIdConfig = async (): Promise<void> => {
  if (jwksClientInstance) return;
  if (!config.auth.openIdDiscoveryUrl) {
    throw new Error("OPENID_DISCOVERY_URL is not configured");
  }
  const discoveryResponse = await axios.get(config.auth.openIdDiscoveryUrl);
  const { jwks_uri } = discoveryResponse.data;
  if (!jwks_uri) {
    throw new Error("JWKS URI not found in OpenID discovery document");
  }
  jwksClientInstance = jwksClient({
    jwksUri: jwks_uri,
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

export async function verifyAccessTokenSignature(token: string): Promise<jwt.JwtPayload> {
  if (!jwksClientInstance) {
    throw new Error("JWKS client not initialized");
  }
  return new Promise((resolve, reject) => {
    jwt.verify(token, getKey, { algorithms: ["RS256"] }, (err, decoded) => {
      if (err) reject(new Error(`Token verification failed: ${err.message}`));
      else resolve(decoded as jwt.JwtPayload);
    });
  });
}

// Trusted X-USER-ACCESS-TOKEN comes from the edge (openid.lua strips any
// client-supplied copy); Authorization Bearer is the local-dev path.
export function getTokenFromHeader(req: Request): string | null {
  const headerToken = req.headers["x-user-access-token"] as string | undefined;
  if (headerToken) return headerToken;
  const auth = req.headers["authorization"];
  if (typeof auth === "string") {
    const [bearer, token] = auth.split(" ");
    if (bearer === "Bearer" && token) return token;
  }
  return null;
}

export async function getUserKey(token: string): Promise<string> {
  const response = await axios.get(`${config.api.nodeUrl}/strato/v2.3/key`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    timeout: 60000,
  });
  if (!response.data?.address) {
    throw new Error("No address returned from STRATO API");
  }
  return response.data.address;
}

export const isAuthInitialized = (): boolean => !!jwksClientInstance;
