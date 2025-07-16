import axios from "axios";
import { clientSecret, clientId, openIdTokenEndpoint } from "../config/config";
import { strato, eth } from "./mercataApiHelper";
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
//  * We fire‐and‐forget any errors here so they don’t block you.
//  */
// async function createKeyViaIdentity(token: string): Promise<void> {
//   try {
//     await eth.get(token, StratoPaths.identity);
//   } catch (err) {
//     console.warn("Failed to create key via identity endpoint:", err);
//   }
// }

/**
 * Fetches an existing STRATO key, or creates one if none exists.
 *
 * @param token - Bearer token for authorization
 * @returns the address string
 */
export async function createOrGetKey(token: string): Promise<string> {
  let address = await getKey(token);
  if (!address) {
    console.info("No key found for the user, creating a new one…");
    address = await createKey(token);
  }

  if (!address) {
    throw new Error("Key creation failed: no address returned after attempting to create a new key");
  }

  return address;
}

/**
 * Fetches the token endpoint from the OpenID Connect discovery document
 */
export async function fetchOpenIdTokenEndpoint(openIdDiscoveryUrl: string | undefined): Promise<string> {
  try {
    if (!openIdDiscoveryUrl) {
      throw new Error("OpenID Discovery URL is not defined");
    }
    
    const response = await axios.get(openIdDiscoveryUrl);
    const { token_endpoint } = response.data;
    
    if (!token_endpoint) {
      throw new Error("Token endpoint not found in OpenID discovery document");
    }
    console.debug("Successfully fetched the token endpoint from OpenID Discovery");
    return token_endpoint;
  } catch (error) {
    console.error("Failed to fetch OpenID discovery data:", error);
    throw new Error("Failed to fetch OpenID discovery data");
  }
}
