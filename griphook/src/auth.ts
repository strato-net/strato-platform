import axios from "axios";
import { OAuthConfig } from "./config.js";

interface OpenIdConfiguration {
  token_endpoint: string;
  authorization_endpoint: string;
  issuer: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  token_type: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const TOKEN_REFRESH_BUFFER_MS = 120 * 1000; // Refresh 2 minutes before expiry

export class OAuthClient {
  private config: OAuthConfig;
  private cachedToken: CachedToken | null = null;
  private tokenEndpoint: string | null = null;
  private pendingTokenRequest: Promise<string> | null = null;

  constructor(config: OAuthConfig) {
    this.config = config;
  }

  async getAccessToken(): Promise<string> {
    // Return cached token if still valid
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt - TOKEN_REFRESH_BUFFER_MS) {
      return this.cachedToken.accessToken;
    }

    // Prevent concurrent token requests
    if (this.pendingTokenRequest) {
      return this.pendingTokenRequest;
    }

    this.pendingTokenRequest = this.fetchNewToken();
    try {
      const token = await this.pendingTokenRequest;
      return token;
    } finally {
      this.pendingTokenRequest = null;
    }
  }

  private async fetchNewToken(): Promise<string> {
    const tokenEndpoint = await this.getTokenEndpoint();

    const params = new URLSearchParams({
      grant_type: "password",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      username: this.config.username,
      password: this.config.password,
      scope: "openid email",
    });

    try {
      const response = await axios.post<TokenResponse>(tokenEndpoint, params.toString(), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 30000,
      });

      const { access_token, expires_in } = response.data;

      this.cachedToken = {
        accessToken: access_token,
        expiresAt: Date.now() + expires_in * 1000,
      };

      return access_token;
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const detail = err.response?.data?.error_description || err.response?.data?.error || err.message;
        throw new Error(`OAuth token request failed (HTTP ${status}): ${detail}`);
      }
      throw new Error(`OAuth token request failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  private async getTokenEndpoint(): Promise<string> {
    if (this.tokenEndpoint) {
      return this.tokenEndpoint;
    }

    try {
      const response = await axios.get<OpenIdConfiguration>(this.config.openIdDiscoveryUrl, {
        timeout: 10000,
      });

      this.tokenEndpoint = response.data.token_endpoint;
      return this.tokenEndpoint;
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        throw new Error(`Failed to fetch OpenID configuration (HTTP ${status}): ${err.message}`);
      }
      throw new Error(`Failed to fetch OpenID configuration: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  /**
   * Decode and return the username from the JWT token payload
   */
  async getUsername(): Promise<string> {
    const token = await this.getAccessToken();
    const payload = token.split(".")[1];
    const decoded = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    return decoded.preferred_username || decoded.email || decoded.sub;
  }

  /**
   * Clear cached token (useful for forcing re-authentication)
   */
  clearCache(): void {
    this.cachedToken = null;
  }
}
