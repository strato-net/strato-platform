import axios from "axios";
import { OAuthConfig } from "./config.js";
import {
  loadCredentials,
  saveCredentials,
  refreshAccessToken,
  StoredCredentials,
} from "./login.js";

interface OpenIdConfiguration {
  token_endpoint: string;
  authorization_endpoint: string;
  issuer: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  token_type: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const TOKEN_REFRESH_BUFFER_MS = 120 * 1000; // Refresh 2 minutes before expiry

export type AuthMode = "browser" | "password" | "token";

export class OAuthClient {
  private config: OAuthConfig | null;
  private cachedToken: CachedToken | null = null;
  private tokenEndpoint: string | null = null;
  private pendingTokenRequest: Promise<string> | null = null;
  private authMode: AuthMode;
  private storedCredentials: StoredCredentials | null = null;

  constructor(config: OAuthConfig | null, authMode: AuthMode = "browser") {
    this.config = config;
    this.authMode = authMode;

    // For browser mode, load stored credentials
    if (authMode === "browser") {
      this.storedCredentials = loadCredentials();
    }
  }

  /**
   * Get the current authentication mode
   */
  getAuthMode(): AuthMode {
    return this.authMode;
  }

  /**
   * Check if browser login credentials are available
   */
  hasBrowserCredentials(): boolean {
    return this.storedCredentials !== null;
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
    switch (this.authMode) {
      case "browser":
        return this.fetchTokenFromBrowserCredentials();
      case "password":
        return this.fetchTokenWithPassword();
      case "token":
        return this.fetchTokenFromEnv();
      default:
        throw new Error(`Unknown auth mode: ${this.authMode}`);
    }
  }

  /**
   * Browser mode: use stored refresh token to get new access token
   */
  private async fetchTokenFromBrowserCredentials(): Promise<string> {
    if (!this.storedCredentials) {
      throw new Error(
        "Not logged in. Run 'griphook login' to authenticate, or set BLOCKAPPS_USERNAME/BLOCKAPPS_PASSWORD for password mode."
      );
    }

    const now = Date.now();

    // Check if access token is still valid
    if (now < this.storedCredentials.expiresAt - TOKEN_REFRESH_BUFFER_MS) {
      this.cachedToken = {
        accessToken: this.storedCredentials.accessToken,
        expiresAt: this.storedCredentials.expiresAt,
      };
      return this.storedCredentials.accessToken;
    }

    // Check if refresh token is still valid
    if (now >= this.storedCredentials.refreshExpiresAt) {
      throw new Error(
        "Session expired. Run 'griphook login' to re-authenticate."
      );
    }

    // Refresh the access token
    try {
      const tokens = await refreshAccessToken(
        this.storedCredentials.openIdDiscoveryUrl,
        this.storedCredentials.clientId,
        this.storedCredentials.refreshToken
      );

      // Update stored credentials
      this.storedCredentials = {
        ...this.storedCredentials,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
        refreshExpiresAt: Date.now() + (tokens.refresh_expires_in || 86400) * 1000,
      };

      // Save updated credentials
      saveCredentials(this.storedCredentials);

      this.cachedToken = {
        accessToken: tokens.access_token,
        expiresAt: this.storedCredentials.expiresAt,
      };

      return tokens.access_token;
    } catch (err) {
      throw new Error(
        `Failed to refresh token: ${err instanceof Error ? err.message : err}. Run 'griphook login' to re-authenticate.`
      );
    }
  }

  /**
   * Password mode: use Resource Owner Password Credentials grant (legacy)
   */
  private async fetchTokenWithPassword(): Promise<string> {
    if (!this.config) {
      throw new Error("OAuth configuration not provided for password mode");
    }

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

  /**
   * Token mode: use pre-provided access token from environment
   */
  private async fetchTokenFromEnv(): Promise<string> {
    const token = process.env.STRATO_ACCESS_TOKEN;
    if (!token) {
      throw new Error("STRATO_ACCESS_TOKEN environment variable not set");
    }

    // We don't know when this token expires, so set a reasonable default
    this.cachedToken = {
      accessToken: token,
      expiresAt: Date.now() + 3600 * 1000, // Assume 1 hour validity
    };

    return token;
  }

  private async getTokenEndpoint(): Promise<string> {
    if (this.tokenEndpoint) {
      return this.tokenEndpoint;
    }

    if (!this.config?.openIdDiscoveryUrl) {
      throw new Error("OpenID discovery URL not configured");
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

/**
 * Determine the appropriate auth mode based on available configuration
 */
export function detectAuthMode(): AuthMode {
  // If access token is directly provided, use token mode
  if (process.env.STRATO_ACCESS_TOKEN) {
    return "token";
  }

  // If username/password provided, use password mode (legacy)
  if (process.env.BLOCKAPPS_USERNAME && process.env.BLOCKAPPS_PASSWORD) {
    return "password";
  }

  // Default to browser mode (uses stored credentials from 'griphook login')
  return "browser";
}
