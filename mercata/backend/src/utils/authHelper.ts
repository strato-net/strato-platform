import axios from "axios";
import { clientSecret, clientId, openIdTokenEndpoint, openIdJwks } from "../config/config";
import { createLocalJWKSet, jwtVerify, JWTPayload, JSONWebKeySet } from "jose";
import { strato } from "./mercataApiHelper";
import { TokenCache, StratoKeyResponse } from "../types/types";
import { StratoPaths } from "../config/constants";

const CACHED_TOKEN: TokenCache = {};

export const getServiceToken = async (): Promise<string> => {
  if (
    CACHED_TOKEN.serviceToken &&
    CACHED_TOKEN.expiresAt &&
    CACHED_TOKEN.expiresAt > Math.floor(Date.now() / 1000) + 120 // 120 seconds leeway threshold
  ) {
    return CACHED_TOKEN.serviceToken;
  }

  try {
    if (!clientId || !clientSecret) {
      throw new Error("Client ID or Client Secret is not defined");
    }
    if (!openIdTokenEndpoint) {
      throw new Error("OpenID Discovery URL is not defined");
    }

    const tokenResponse = await axios.post(
      openIdTokenEndpoint,
      new URLSearchParams({
        grant_type: "client_credentials",
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization:
            "Basic " +
            Buffer.from(`${clientId}:${clientSecret}`).toString(
              "base64"
            ),
        },
      }
    );

    const { access_token, expires_in } = tokenResponse.data;

    if (!access_token) throw new Error("No access token returned");

    CACHED_TOKEN.serviceToken = access_token;
    CACHED_TOKEN.expiresAt = Math.floor(Date.now() / 1000) + expires_in;

    return access_token;
  } catch (error) {
    console.error("Failed to retrieve service token:", error);
    throw new Error("Service token retrieval failed");
  }
};

/**
 * Try to get an existing STRATO key.
 * @returns the address, or null if none exists yet.
 * @throws on non-400 failures.
 */
async function getKey(token: string): Promise<string | null> {
  try {
    const { data } = await strato.get<StratoKeyResponse>(
      token,
      StratoPaths.key
    );
    return data.address ?? null;
  } catch (err) {
    // 400 means "no key yet" for that API endpoint (STRATO API should ideally return 404, but we work with what we have)
    if (axios.isAxiosError(err) && err.response?.status === 400) {
      return null;
    } else {
      console.error("Error getting key:", err);
      throw new Error("Key retrieval failed");
    }
  }
}

/**
 * Create a STRATO key.
 * @returns the address, or null in case of an error
 * @throws on failures.
 */
async function createKey(token: string): Promise<string | null> {
  try {
    const { data } = await strato.post<StratoKeyResponse>(
      token,
      StratoPaths.key
    );
    return data.address ?? null;
  } catch (err) {
    console.error("Error creating key:", err);
    return null;
  }
}

// DEPRECATED: Identity Server and proxy are deprecated as of May 26th 2025
// /**
//  * Hit the identity endpoint to create the key.
//  * We fire‐and‐forget any errors here so they don't block you.
//  */
// async function createKeyViaIdentity(token: string): Promise<void> {
//   try {
//     await eth.get(token, StratoPaths.identity);
//   } catch (err) {
//     console.warn("Failed to create key via identity endpoint:", err);
//   }
// }

// Tracks STRATO addresses that were just created by this server. Used to
// surface `isNew=true` on parallel mount-time API calls during the post-signup
// page load (without it, only the racing-first call sees isNew=true and the
// signal is lost to non-attribution consumers).
const RECENTLY_CREATED_ADDRESSES = new Map<string, number>();
const NEW_USER_WINDOW_MS = 60_000;

function markNewlyCreated(address: string): void {
  RECENTLY_CREATED_ADDRESSES.set(address, Date.now());
  if (RECENTLY_CREATED_ADDRESSES.size > 1000) {
    const cutoff = Date.now() - NEW_USER_WINDOW_MS;
    for (const [addr, ts] of RECENTLY_CREATED_ADDRESSES) {
      if (ts < cutoff) RECENTLY_CREATED_ADDRESSES.delete(addr);
    }
  }
}

function isRecentlyCreated(address: string): boolean {
  const ts = RECENTLY_CREATED_ADDRESSES.get(address);
  if (!ts) return false;
  if (Date.now() - ts > NEW_USER_WINDOW_MS) {
    RECENTLY_CREATED_ADDRESSES.delete(address);
    return false;
  }
  return true;
}

/**
 * Fetches an existing STRATO key, or creates one if none exists.
 *
 * @param token - Bearer token for authorization
 * @returns the address string and a flag indicating whether the key was just created
 */
export async function createOrGetKey(token: string): Promise<{ address: string; isNew: boolean }> {
  let address = await getKey(token);
  let isNew = false;
  if (!address) {
    console.info("No key found for the user, creating a new one…");
    address = await createKey(token);
    if (address) {
      isNew = true;
      markNewlyCreated(address);
    }
  } else if (isRecentlyCreated(address)) {
    isNew = true;
  }

  if (!address) {
    throw new Error("Key creation failed: no address returned after attempting to create a new key");
  }

  return { address, isNew };
}

/**
 * Fetches both token endpoint and JWKS from the OpenID Connect discovery document
 */
export async function fetchOpenIdConfig(openIdDiscoveryUrl: string | undefined): Promise<{ tokenEndpoint: string; jwks: JSONWebKeySet }> {
  try {
    if (!openIdDiscoveryUrl) {
      throw new Error("OpenID Discovery URL is not defined");
    }
    
    const discoveryResponse = await axios.get(openIdDiscoveryUrl);
    const { token_endpoint, jwks_uri } = discoveryResponse.data;

    if (!token_endpoint) {
      throw new Error("Token endpoint not found in OpenID discovery document");
    }
    if (!jwks_uri) {
      throw new Error("JWKS URI not found in OpenID discovery document");
    }

    // The discovery document reports endpoints (jwks_uri, token_endpoint) using
    // the OAuth issuer's external URL. When we fetched discovery from an internal
    // origin (--localAuth, e.g. http://local-auth:4444), those external URLs
    // route back through the public HTTPS endpoint and fail certificate
    // verification (e.g. an untrusted Cloudflare Origin cert). Resolve the
    // endpoints against the same origin we used for discovery so subsequent hops
    // (JWKS fetch, client-credentials token requests) also stay internal. For an
    // external provider, discovery and these endpoints share the issuer origin,
    // so this rewrite is a no-op.
    const discoveryOrigin = new URL(openIdDiscoveryUrl).origin;
    const toDiscoveryOrigin = (endpoint: string): string => {
      const url = new URL(endpoint);
      return `${discoveryOrigin}${url.pathname}${url.search}`;
    };
    const resolvedTokenEndpoint = toDiscoveryOrigin(token_endpoint);
    const resolvedJwksUri = toDiscoveryOrigin(jwks_uri);

    const jwksResponse = await axios.get(resolvedJwksUri);
    const jwks = jwksResponse.data as JSONWebKeySet;

    if (!jwks || !Array.isArray(jwks.keys)) {
      throw new Error("Invalid JWKS response from OpenID provider");
    }

    console.debug("Successfully fetched OpenID configuration and JWKS");
    return { tokenEndpoint: resolvedTokenEndpoint, jwks };
  } catch (error) {
    console.error("Failed to fetch OpenID discovery data:", error);
    throw new Error("Failed to fetch OpenID discovery data");
  }
}

/**
 * JWT verification using cached JWKS
 */
let cachedJwksVerifier: any | undefined;

export async function verifyAccessTokenSignature(token: string): Promise<JWTPayload> {
  if (!openIdJwks) {
    throw new Error("JWKS not initialized");
  }
  if (!cachedJwksVerifier) {
    cachedJwksVerifier = createLocalJWKSet(openIdJwks);
  }
  const { payload } = await jwtVerify(token, cachedJwksVerifier);
  return payload;
}
