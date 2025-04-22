import axios from "axios";
import { clientSecret, clientId, openIdTokenEndpoint } from "../config/config";
import { strato } from "./mercataApiHelper";

interface TokenCache {
  serviceToken?: string;
  expiresAt?: number;
}

const CACHED_TOKEN: TokenCache = {};

export const getServiceToken = async (): Promise<string> => {
  if (
    CACHED_TOKEN.serviceToken &&
    CACHED_TOKEN.expiresAt &&
    CACHED_TOKEN.expiresAt > Math.floor(Date.now() / 1000) + 60 // 60 seconds buffer
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

export const createOrGetKey = async ({ token }: { token: string }) => {
  try {
    // Attempt to fetch existing key
    const {
      data: { address },
    } = await strato.get(token, "/key");
    if (address) return address;
    throw new Error("No address returned");
  } catch {
    // Create a new key if fetch failed or no address
    const { data } = await strato.post(token, "/key");
    return data.address ?? data;
  }
};
