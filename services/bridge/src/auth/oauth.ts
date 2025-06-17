import axios from "axios";
import simpleOauth2 from "simple-oauth2";

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
  private oauth2: any;

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

      // Initialize OAuth2 client
      const credentials = {
        client: {
          id: oauth.clientId,
          secret: oauth.clientSecret,
        },
        auth: {
          tokenHost: new URL(oauth.tokenEndpoint).origin,
          tokenPath: new URL(oauth.tokenEndpoint).pathname,
        },
      };

      // @ts-ignore - ResourceOwnerPassword exists at runtime but not in types
      oauth.oauth2 = new simpleOauth2.ResourceOwnerPassword(credentials);

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
        username,
        password,
        scope: this.scope,
      };

      const result = await this.oauth2.getToken(tokenParams);

      // Ensure all numeric values are properly converted
      const tokenData = {
        ...result.token,
        expires_in: Number(result.token.expires_in) || 0,
        refresh_expires_in: Number(result.token.refresh_expires_in) || 0,
        expires_at: Date.now() / 1000 + (Number(result.token.expires_in) || 0),
      };

      return {
        token: tokenData,
      };
    } catch (error: any) {
      console.error("❌ Token Request Error:", {
        error: error?.message,
        response: error?.response?.data,
        status: error?.response?.status,
        config: {
          tokenEndpoint: this.tokenEndpoint,
          scope: this.scope,
          clientId: this.clientId,
        },
      });
      throw new Error(
        `Failed to get access token: ${error?.message || "Unknown error"}`
      );
    }
  }
}

export default OAuthUtil;
