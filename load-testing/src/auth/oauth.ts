import simpleOauth2 from "simple-oauth2";
import axios from "axios";
import { AuthConfig } from "../types";

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

export class OAuthClient {
  private oauth2: simpleOauth2.ResourceOwnerPassword | null = null;
  private cachedToken: CachedToken | null = null;
  private config: AuthConfig;

  constructor(config: AuthConfig) {
    this.config = config;
  }

  async init(): Promise<void> {
    const { data: openIdConfig } = await axios.get(this.config.openIdDiscoveryUrl);
    const tokenEndpoint: string = openIdConfig.token_endpoint;

    const credentials = {
      client: {
        id: this.config.clientId,
        secret: this.config.clientSecret,
      },
      auth: {
        tokenHost: new URL(tokenEndpoint).origin,
        tokenPath: new URL(tokenEndpoint).pathname,
      },
    };

    this.oauth2 = new simpleOauth2.ResourceOwnerPassword(credentials);
  }

  async getToken(): Promise<string> {
    // Return cached token if still valid (with 30s buffer)
    if (this.cachedToken && Date.now() / 1000 < this.cachedToken.expiresAt - 30) {
      return this.cachedToken.accessToken;
    }

    if (!this.oauth2) {
      await this.init();
    }

    const result = await this.oauth2!.getToken({
      username: this.config.username,
      password: this.config.password,
      scope: "openid email profile",
    });

    const token = result.token as any;
    this.cachedToken = {
      accessToken: token.access_token,
      expiresAt: Date.now() / 1000 + (Number(token.expires_in) || 300),
    };

    return this.cachedToken.accessToken;
  }
}
