import axios from "axios";

interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  openIdDiscoveryUrl: string;
  scope?: string;
  tokenField?: string;
}

interface TokenData {
  access_token: string;
  expires_in: number;
  refresh_expires_in: number;
  refresh_token: string;
  token_type: string;
  session_state: string;
  scope: string;
  expires_at: number;
  [key: string]: string | number; // Allow dynamic string indexing
}

interface TokenResponse {
  token: TokenData;
}

class OAuthUtil {
  private clientId: string;
  private clientSecret: string;
  private openIdDiscoveryUrl: string;
  private scope: string;
  private tokenField: string;
  private tokenEndpoint: string = "";

  constructor(config: OAuthConfig) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.openIdDiscoveryUrl = config.openIdDiscoveryUrl;
    this.scope = config.scope || "openid email profile";
    this.tokenField = config.tokenField || "access_token";
  }

  /**
   * Initialize OAuth utility
   */
  static async init(config: OAuthConfig): Promise<OAuthUtil> {
    try {
      const oauth = new OAuthUtil(config);

      // Fetch OpenID configuration
      const response = await axios.get(oauth.openIdDiscoveryUrl);
      const openIdConfig = response.data;
      oauth.tokenEndpoint = openIdConfig.token_endpoint;

      return oauth;
    } catch (error: any) {
      console.error("❌ OAuth Initialization Error:", {
        error: error?.message,
        response: error?.response?.data,
        status: error?.response?.status,
        stack: error?.stack,
      });
      throw new Error(
        `Failed to initialize OAuth: ${error?.message || "Unknown error"}`
      );
    }
  }

  /**
   * Get access token using resource owner credentials
   */
  async getAccessTokenByResourceOwnerCredential(
    username: string,
    password: string
  ): Promise<TokenResponse> {
    try {
      const tokenParams = {
        grant_type: 'password',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        username,
        password,
        scope: this.scope,
      };

      const response = await axios.post(this.tokenEndpoint, tokenParams, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const tokenData = response.data;
      const expiresAt = Math.floor(Date.now() / 1000) + tokenData.expires_in;

      return {
        token: {
          ...tokenData,
          expires_at: expiresAt
        }
      };
    } catch (error: any) {
      console.error("❌ Token Fetch Error:", {
        error: error?.message,
        response: error?.response?.data,
        status: error?.response?.status,
      });
      throw new Error(
        `Failed to fetch access token: ${error?.message || "Unknown error"}`
      );
    }
  }
}

export default OAuthUtil; 