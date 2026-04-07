import OAuthUtil from "./oauth";
import { config } from "../config";
import { logError } from "../utils/logger";
import { strato } from "../utils/api";
import { Request } from "express";
import axios from "axios";
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";


// Validation function to check config at runtime
const validateConfig = () => {
  if (!config.auth?.clientId) {
    throw new Error("CLIENT_ID is not configured");
  }
  if (!config.auth?.clientSecret) {
    throw new Error("CLIENT_SECRET is not configured");
  }
  if (!config.auth?.openIdDiscoveryUrl) {
    throw new Error("OPENID_DISCOVERY_URL is not configured");
  }
};

const getOAuthConfig = () => {
  validateConfig();
  return {
    clientId: config.auth.clientId!,
    clientSecret: config.auth.clientSecret!,
    openIdDiscoveryUrl: config.auth.openIdDiscoveryUrl!,
    scope: "openid email profile",
    tokenField: "access_token",
  };
};

interface TokenData {
  token: string;
  expiresAt: number;
}

const CACHED_DATA: {
  [key: string]: TokenData | null;
} = {
  serviceToken: null,
};

let cachedUserAddress: string | null = null;

const TOKEN_LIFETIME_THRESHOLD_SECONDS = 10;

// Add singleton pattern for OAuth initialization
let oauthInitialized = false;
let oauthInstance: any = null;

// JWKS client for token verification
let jwksUri: string | undefined;
let jwksClientInstance: jwksClient.JwksClient | undefined;

/**
 * Fetches JWKS URI from the OpenID Connect discovery document
 */
async function fetchJwksUri(openIdDiscoveryUrl: string | undefined): Promise<string> {
  try {
    if (!openIdDiscoveryUrl) {
      throw new Error("OpenID Discovery URL is not defined");
    }

    const discoveryResponse = await axios.get(openIdDiscoveryUrl);
    const { jwks_uri } = discoveryResponse.data;

    if (!jwks_uri) {
      throw new Error("JWKS URI not found in OpenID discovery document");
    }

    console.log("[Auth] Successfully fetched JWKS URI");
    return jwks_uri;
  } catch (error) {
    console.error("[Auth] Failed to fetch OpenID discovery data:", error);
    throw new Error("Failed to fetch OpenID discovery data");
  }
}

export const initOpenIdConfig = async () => {
  // If already initialized, return immediately
  if (oauthInitialized) {
    console.log(`[Auth] OAuth already initialized, skipping`);
    return;
  }

  try {
    console.log(`[Auth] Initializing OAuth with config:`, {
      clientId: config.auth.clientId,
      hasClientSecret: !!config.auth.clientSecret,
      openIdDiscoveryUrl: config.auth.openIdDiscoveryUrl,
      hasUsername: !!config.auth.baUsername,
      hasPassword: !!config.auth.baPassword
    });

    // Initialize OAuth client
    oauthInstance = await OAuthUtil.init(getOAuthConfig());

    // Fetch JWKS URI for token verification
    jwksUri = await fetchJwksUri(config.auth.openIdDiscoveryUrl);
    jwksClientInstance = jwksClient({
      jwksUri: jwksUri,
      cache: true,
      cacheMaxAge: 600000, // 10 minutes
    });

    oauthInitialized = true;

    console.log(`[Auth] OAuth initialization completed successfully`);
  } catch (error) {
    console.error(`[Auth] OAuth initialization failed:`, {
      errorMessage: (error as Error)?.message,
      errorName: (error as Error)?.name,
      errorStack: (error as Error)?.stack
    });

    logError("Auth", error as Error, { operation: "initOpenIdConfig" });
    throw error;
  }
};

export const getBAUserToken = async (): Promise<string> => {
  if (!config.auth.baUsername) {
    throw new Error("BA_USERNAME is not configured");
  }

  const cacheKey = config.auth.baUsername;
  const userTokenData = CACHED_DATA[cacheKey];
  const currentTime = Math.floor(Date.now() / 1000);

  // console.debug(`[Auth] Token cache check:`, {
  //   username: config.auth.baUsername,
  //   cacheKey,
  //   currentTime,
  //   hasCachedToken: !!userTokenData,
  //   cachedTokenExpiresAt: userTokenData?.expiresAt,
  //   timeUntilExpiry: userTokenData ? userTokenData.expiresAt - currentTime : 'N/A',
  //   thresholdSeconds: TOKEN_LIFETIME_THRESHOLD_SECONDS,
  //   isTokenValid: userTokenData ? userTokenData.expiresAt > currentTime + TOKEN_LIFETIME_THRESHOLD_SECONDS : false
  // });

  // Check if a valid cached token exists
  if (
    userTokenData &&
    userTokenData.token &&
    userTokenData.expiresAt > currentTime + TOKEN_LIFETIME_THRESHOLD_SECONDS
  ) {
    // console.debug(`[Auth] Using cached token`);
    return userTokenData.token;
  }

  // console.debug(`[Auth] Need to fetch new token`);

  try {
    if (!oauthInstance) {
      throw new Error(
        "OAuth client not initialized. Call initOpenIdConfig() first",
      );
    }

    if (!config.auth.baPassword) {
      throw new Error("BA_PASSWORD is not configured");
    }

    // console.debug(`[Auth] Calling OAuth getAccessTokenByResourceOwnerCredential...`);

    // Fetch a new token using Resource Owner Password Credentials
    const tokenObj =
      await oauthInstance.getAccessTokenByResourceOwnerCredential(
        config.auth.baUsername,
        config.auth.baPassword,
      );

    // console.debug(`[Auth] Token object received:`, {
    //   hasToken: !!tokenObj?.token,
    //   tokenKeys: tokenObj?.token ? Object.keys(tokenObj.token) : 'No token',
    //   tokenField: getOAuthConfig().tokenField
    // });

    // Type assertion for token object
    const token = tokenObj.token[getOAuthConfig().tokenField] as string;
    const expiresAt = tokenObj.token.expires_at as number;

    // console.debug(`[Auth] Token extracted:`, {
    //   hasAccessToken: !!token,
    //   expiresAt,
    //   expiresIn: expiresAt - currentTime
    // });

    // Cache the new token
    CACHED_DATA[cacheKey] = { token, expiresAt };
    // console.debug(`[Auth] Token cached successfully`);

    return token;
  } catch (error: any) {
    console.error(`[Auth] getBAUserToken error:`, {
      errorMessage: error?.message,
      errorName: error?.name,
      errorStack: error?.stack,
      hasOAuthInstance: !!oauthInstance,
      hasPassword: !!config.auth.baPassword,
      username: config.auth.baUsername
    });

    throw new Error(
      `Failed to fetch user OAuth token: ${error?.message || "Unknown error"}`,
    );
  }
};

export const getBAUserAddress = async (): Promise<string> => {
  if (cachedUserAddress) {
    return cachedUserAddress;
  }

  try {
    const response = await strato.get('/key');
    cachedUserAddress = response.address;
    return cachedUserAddress!;
  } catch (error: any) {
    throw new Error(
      `Failed to fetch user address: ${error?.message || "Unknown error"}`,
    );
  }
};

/**
 * Get signing key from JWKS
 */
function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) {
  if (!jwksClientInstance) {
    return callback(new Error("JWKS client not initialized"));
  }

  jwksClientInstance.getSigningKey(header.kid, (err, key) => {
    if (err) {
      return callback(err);
    }
    const signingKey = key?.getPublicKey();
    callback(null, signingKey);
  });
}

/**
 * Verify access token signature using JWKS
 */
export async function verifyAccessTokenSignature(token: string): Promise<jwt.JwtPayload> {
  if (!jwksClientInstance) {
    throw new Error("JWKS client not initialized. Call initOpenIdConfig() first");
  }

  return new Promise((resolve, reject) => {
    jwt.verify(token, getKey, {
      algorithms: ['RS256'],
    }, (err, decoded) => {
      if (err) {
        reject(new Error(`Token verification failed: ${err.message}`));
      } else {
        resolve(decoded as jwt.JwtPayload);
      }
    });
  });
}

/**
 * Get the token from the header (x-user-access-token if it's present, or authorization header if not)
 * @param req - The request object
 * @returns The token from the header
 */
export function getTokenFromHeader(req: Request): string | null {
  // Handle header from nginx
  const headerToken = req.headers["x-user-access-token"] as string | undefined;
  if (headerToken) return headerToken;

  // Handle header from local development mode
  const auth = req.headers["authorization"];

  if (typeof auth === "string") {
    const [bearer, token] = auth.split(" ");
    if (bearer === "Bearer" && token) return token;
  }
  return null;
}

/**
 * Try to get the STRATO address for a user token.
 * @returns the address, or null if none exists yet.
 * @throws on strato API failures or null address response.
 */
export async function getUserKey(token: string): Promise<string> {
  try {
    const response = await axios.get(
      `${config.api.nodeUrl}/strato/v2.3/key`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    );
    if (!response.data.address) {
      throw new Error("No address returned from STRATO API");
    }
    return response.data.address;
  } catch (err: any) {
    console.error("Error getting user key:", err);
    throw new Error("Address retrieval failed");
  }
}
