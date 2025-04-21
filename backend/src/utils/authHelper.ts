import axios from "axios";
import { clientSecret, clientId, openIdDiscoveryUrl } from "../config/config";
import { getNetworkApiClient } from "./mercataApiHelper";

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
    const tokenResponse = await axios.post(
      openIdDiscoveryUrl ?? "",
      new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId ?? "",
        client_secret: clientSecret ?? "",
        scope: "email openid",
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
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

export const createOrGetKey = async (user: any) => {
  const apiClient = getNetworkApiClient(user.token);

  try {
    const { status, data } = await apiClient.get("/key");
    if (status !== 200 || !data || !data.address) {
      throw new Error("Failed to fetch key");
    }
    return data.address;
  } catch (getError) {
    console.warn("Key not found, attempting creation:", getError);
  }

  try {
    const response = await apiClient.post("/key", {});
    return response.data;
  } catch (createError) {
    console.error("Failed to create key:", createError);
    throw new Error("Key creation failed");
  }
};
