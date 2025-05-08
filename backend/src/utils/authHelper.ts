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
 * Try to fetch an existing Strato key.
 * @returns the address, or null if none exists yet.
 * @throws on non-404 failures.
 */
async function fetchKey(token: string): Promise<string | null> {
  try {
    const { data } = await strato.get<StratoKeyResponse>(
      token,
      StratoPaths.key
    );
    return data.address ?? null;
  } catch (err) {
    // 404 means “no key yet”, rest bubble up
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      return null;
    }
    console.error("Error fetching key:", err);
    throw new Error("Key retrieval failed");
  }
}

/**
 * Hit the identity endpoint to create the key.
 * We fire‐and‐forget any errors here so they don’t block you.
 */
async function createKeyViaIdentity(token: string): Promise<void> {
  try {
    await eth.get(token, StratoPaths.identity);
  } catch (err) {
    console.warn("Failed to create key via identity endpoint:", err);
  }
}

/**
 * Fetches an existing Strato key, or creates one (and registers its identity) if none exists.
 *
 * @param token - Bearer token for authorization
 * @returns the address string
 */
export async function createOrGetKey(token: string): Promise<string> {
  // 1️⃣ Try to fetch an existing key
  let address = await fetchKey(token);
  if (address) {
    return address;
  }

  console.info("No key found, creating a new one via identity endpoint…");

  // 2️⃣ Create it
  await createKeyViaIdentity(token);

  // 3️⃣ Re-fetch; if still no address, that’s a real failure
  address = await fetchKey(token);
  if (!address) {
    throw new Error("Key creation failed: no address after identity call");
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
