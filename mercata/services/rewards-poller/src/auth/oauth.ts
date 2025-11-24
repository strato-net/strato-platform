import axios from "axios";
import simpleOauth2 from "simple-oauth2";
import { fetch } from "../utils/api";

interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  openIdDiscoveryUrl: string;
  scope?: string;
  tokenField?: string;
}

interface TokenResponse {
  token: any;
}

interface OAuthTokenResult {
  token: {
    access_token: string;
    expires_in: number;
    refresh_expires_in?: number;
    [key: string]: any;
  };
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

  static async init(config: OAuthConfig): Promise<OAuthUtil> {
    try {
      const oauth = new OAuthUtil(config);

      const openIdConfig = await fetch.get(oauth.openIdDiscoveryUrl);
      oauth.tokenEndpoint = openIdConfig.token_endpoint;

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

      oauth.oauth2 = new simpleOauth2.ResourceOwnerPassword(credentials);

      return oauth;
    } catch (error: any) {
      throw new Error(
        `Failed to initialize OAuth: ${error?.message || "Unknown error"}`,
      );
    }
  }

  async getAccessTokenByResourceOwnerCredential(
    username: string,
    password: string,
  ): Promise<TokenResponse> {
    try {
      const tokenParams = {
        username,
        password,
        scope: this.scope,
      };
      let result
      try {
        result = await this.oauth2.getToken(tokenParams) as OAuthTokenResult;
      } catch (error: any) {
        console.error(`[OAuth Debug] oauth2.getToken() failed:`, {
          errorMessage: error?.message,
          errorCode: error?.code,
          hasResponse: !!error?.response,
          statusCode: error?.response?.status,
          statusText: error?.response?.statusText,
          contentType: error?.response?.headers?.["content-type"],
          responseDataType: typeof error?.response?.data,
          responseDataPreview: error?.response?.data ? 
            (typeof error?.response?.data === 'string' ? 
              error.response.data.substring(0, 300) : 
              JSON.stringify(error.response.data).substring(0, 300)
            ) : 'No response data'
        });
        throw new Error(`Error obtaining token. Result: ${result}; Error: ${error?.message}`);
      }
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
      console.error(`[OAuth Debug] Final error handler triggered:`, {
        errorMessage: error?.message,
        errorName: error?.name,
        errorCode: error?.code,
        hasResponse: !!error?.response,
        statusCode: error?.response?.status,
        statusText: error?.response?.statusText,
        responseHeaders: error?.response?.headers,
        responseDataType: typeof error?.response?.data,
        responseDataFull: error?.response?.data,
        stackTrace: error?.stack
      });
      
      if (error.response?.data) {
        const contentType = error.response.headers["content-type"] || "";
        console.error(`[OAuth Debug] Processing HTTP response error - Content-Type: ${contentType}`);
        
        if (!contentType.includes("application/json")) {
          console.error(`[OAuth Debug] Non-JSON response detected!`);
          throw new Error(
            `OAuth endpoint returned non-JSON content (${contentType}). Response: ${error.response.data.substring(0, 200)}...`,
          );
        }
        throw new Error(`OAuth error: ${JSON.stringify(error.response.data)}`);
      }

      throw new Error(
        `Failed to get access token: ${error?.message || "Unknown error"}`,
      );
    }
  }
}

export default OAuthUtil;

