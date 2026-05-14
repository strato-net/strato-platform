import simpleOauth2 from "simple-oauth2";
import axios from "axios";
import { AuthConfig } from "../types";

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

/**
 * Wraps a Keycloak Resource-Owner-Password-Grant token fetch with two
 * concurrency guarantees:
 *
 *   1. Per-instance cache. The token is held until 30 s before expiry so
 *      hot-path callers reuse it without contacting Keycloak.
 *   2. Single-flight refresh. When the token expires (or is missing), only
 *      ONE outstanding `getToken()` call talks to Keycloak; concurrent callers
 *      join the same in-flight Promise. This is essential when one OAuthClient
 *      instance is shared across many concurrent workers, because Keycloak
 *      enforces a per-user rate limit (>1 grant in <1 sec returns 400/429).
 *
 * Identity helpers (`username`, `clientId`) are exposed publicly so callers
 * can dedupe instances by user — the recommended pattern is "one OAuthClient
 * per unique (clientId, username), shared across all BackendClients that map
 * to that user."
 */
export class OAuthClient {
  private oauth2: simpleOauth2.ResourceOwnerPassword | null = null;
  private cachedToken: CachedToken | null = null;
  private inflightFetch: Promise<string> | null = null;
  private config: AuthConfig;

  /** Convenience identity tags so callers can dedupe / diagnose. */
  public readonly username: string;
  public readonly clientId: string;

  constructor(config: AuthConfig) {
    this.config = config;
    this.username = config.username;
    this.clientId = config.clientId;
  }

  /** Idempotent — safe to call multiple times. */
  async init(): Promise<void> {
    if (this.oauth2) return;
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
    // Fast path: cached token still valid (with 30 s safety margin).
    if (this.cachedToken && Date.now() / 1000 < this.cachedToken.expiresAt - 30) {
      return this.cachedToken.accessToken;
    }

    // Single-flight: if a refresh is already running, join it instead of
    // firing another grant for the same user.
    if (this.inflightFetch) return this.inflightFetch;

    this.inflightFetch = this.fetchAndCache();
    try {
      return await this.inflightFetch;
    } finally {
      this.inflightFetch = null;
    }
  }

  private async fetchAndCache(): Promise<string> {
    if (!this.oauth2) await this.init();

    let lastErr: any = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
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
      } catch (err: any) {
        lastErr = err;
        // Keycloak per-user rate limit returns HTTP 400 ("invalid_grant" with
        // "user is temporarily disabled") or 429. Back off ~1.5 s + jitter and
        // retry once. Any other error fails fast.
        const status = err?.output?.statusCode ?? err?.response?.status;
        const isRateLimited = status === 429 || status === 400;
        if (attempt === 0 && isRateLimited) {
          const backoff = 1500 + Math.floor(Math.random() * 500);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        break;
      }
    }
    throw lastErr;
  }
}
