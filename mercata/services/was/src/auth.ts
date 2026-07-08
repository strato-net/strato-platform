import axios from "axios";
import { AccessTokenProvider } from "./cirrusClient";
import { WasConfig } from "./types";

interface OpenIdDiscoveryDocument {
  token_endpoint?: string;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const TOKEN_REFRESH_LEEWAY_SECONDS = 120;

export const createAccessTokenProvider = (
  config: WasConfig,
): AccessTokenProvider => {
  let tokenEndpoint: string | undefined;
  let cachedToken: CachedToken | undefined;

  return async () => {
    const { discoveryUrl, clientId, clientSecret } = config.oauth || {};
    if (!discoveryUrl || !clientId || !clientSecret) return undefined;

    const now = Math.floor(Date.now() / 1000);
    if (
      cachedToken &&
      cachedToken.expiresAt > now + TOKEN_REFRESH_LEEWAY_SECONDS
    ) {
      return cachedToken.accessToken;
    }

    if (!tokenEndpoint) {
      const response = await axios.get<OpenIdDiscoveryDocument>(discoveryUrl);
      if (!response.data.token_endpoint) {
        throw new Error("Token endpoint not found in OpenID discovery document");
      }
      tokenEndpoint = response.data.token_endpoint;
    }

    const tokenResponse = await axios.post<TokenResponse>(
      tokenEndpoint,
      new URLSearchParams({ grant_type: "client_credentials" }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization:
            "Basic " +
            Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
        },
      },
    );

    if (!tokenResponse.data.access_token) {
      throw new Error("No access token returned");
    }

    cachedToken = {
      accessToken: tokenResponse.data.access_token,
      expiresAt: now + (tokenResponse.data.expires_in || 0),
    };

    return cachedToken.accessToken;
  };
};
