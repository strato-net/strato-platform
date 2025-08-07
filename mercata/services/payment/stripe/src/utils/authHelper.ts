import axios from "axios";
import { clientSecret, clientId, openIdTokenEndpoint } from "../config/config";
import { TokenCache } from "../types/types";

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
      openIdTokenEndpoint ?? "",
      new URLSearchParams({
        grant_type: "client_credentials",
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization:
            "Basic " +
            Buffer.from(`${clientId ?? ""}:${clientSecret ?? ""}`).toString(
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
