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
/**
 * Process-wide rate limiter for Keycloak token-endpoint requests.
 *
 * Keycloak (and the nginx layer in front of it) starts returning HTTP
 * 400/429/503 once the aggregate grant rate climbs past a few tens of
 * requests per second. With concurrentUsers > 20 we can easily exceed that
 * on warmup alone, so we serialize all grant dispatches across every
 * OAuthClient instance and enforce a minimum spacing between consecutive
 * outbound requests. 20 req/s → 50 ms minimum gap.
 *
 * This is a simple FIFO promise chain: every gated call appends a task
 * that (a) sleeps until at least `lastDispatchAt + minIntervalMs`, (b)
 * updates `lastDispatchAt`, then (c) runs the caller's work. The chain
 * itself is awaited so backpressure naturally builds up under high
 * concurrency instead of spiking the server.
 */
const KEYCLOAK_RATE_LIMIT_PER_SEC = 20;
const KEYCLOAK_MIN_INTERVAL_MS = Math.ceil(1000 / KEYCLOAK_RATE_LIMIT_PER_SEC);
let keycloakDispatchChain: Promise<void> = Promise.resolve();
let keycloakLastDispatchAt = 0;
function gateKeycloakRequest<T>(work: () => Promise<T>): Promise<T> {
  const slot = keycloakDispatchChain.then(async () => {
    const now = Date.now();
    const wait = Math.max(0, keycloakLastDispatchAt + KEYCLOAK_MIN_INTERVAL_MS - now);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    keycloakLastDispatchAt = Date.now();
  });
  // Chain swallows errors from `work` so one failure doesn't break the gate
  // for subsequent callers; the original promise we hand back to the caller
  // still surfaces the error.
  keycloakDispatchChain = slot.catch(() => undefined);
  return slot.then(work);
}

export class OAuthClient {
  private oauth2: simpleOauth2.ResourceOwnerPassword | null = null;
  private cachedToken: CachedToken | null = null;
  private inflightFetch: Promise<string> | null = null;
  private config: AuthConfig;
  /** Cached token endpoint resolved from the OIDC discovery doc. Used by
   *  the diagnostic raw-POST path so we can surface the upstream Keycloak
   *  response (status, headers, body) when simple-oauth2 / wreck throws. */
  private tokenEndpoint: string | null = null;

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
    this.tokenEndpoint = tokenEndpoint;

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

  /**
   * Diagnostic-only raw token grant. Re-issues the Resource-Owner-Password
   * grant via plain axios (NOT simple-oauth2) so we can surface the actual
   * HTTP status Keycloak (or any proxy in front of it) returned, even in
   * cases where simple-oauth2 / @hapi/wreck throws non-status-bearing errors
   * like "The content-type is not JSON compatible".
   *
   * Never throws — best-effort logging only. The original error from
   * fetchAndCache is what propagates to the caller.
   */
  private async logRawTokenResponse(context: string): Promise<void> {
    if (!this.tokenEndpoint) {
      console.warn(
        `[oauth-debug] ${context} (${this.clientId}::${this.username}): ` +
          `no resolved tokenEndpoint yet`,
      );
      return;
    }
    try {
      const body = new URLSearchParams({
        grant_type: "password",
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        username: this.config.username,
        password: this.config.password,
        scope: "openid email profile",
      });
      const resp = await gateKeycloakRequest(() =>
        axios.post(this.tokenEndpoint!, body.toString(), {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          validateStatus: () => true,
          transformResponse: (x) => x,
          timeout: 15000,
        }),
      );
      console.warn(
        `[oauth-debug] ${context} (${this.clientId}::${this.username}): ` +
          `http status=${resp.status}`,
      );
    } catch (probeErr: any) {
      const probeStatus = probeErr?.response?.status;
      console.warn(
        `[oauth-debug] ${context} (${this.clientId}::${this.username}): ` +
          `probe failed${probeStatus ? ` http status=${probeStatus}` : ""}`,
      );
    }
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
        const result = await gateKeycloakRequest(() =>
          this.oauth2!.getToken({
            username: this.config.username,
            password: this.config.password,
            scope: "openid email profile",
          }),
        );
        const token = result.token as any;
        this.cachedToken = {
          accessToken: token.access_token,
          expiresAt: Date.now() / 1000 + (Number(token.expires_in) || 300),
        };
        return this.cachedToken.accessToken;
      } catch (err: any) {
        lastErr = err;
        // simple-oauth2 wraps Keycloak responses via @hapi/wreck. On HTTP
        // errors it attaches `err.output.statusCode`; on body-parse errors
        // (e.g. "content-type is not JSON compatible") there's no status, so
        // we fall back to a raw axios probe to surface the real one.
        const status = err?.output?.statusCode ?? err?.response?.status;
        if (status != null) {
          console.warn(
            `[oauth-debug] grant attempt ${attempt} for ` +
              `${this.clientId}::${this.username}: http status=${status}`,
          );
        } else {
          await this.logRawTokenResponse(`grant attempt ${attempt}`);
        }

        // Keycloak per-user rate limit returns HTTP 400 ("invalid_grant" with
        // "user is temporarily disabled") or 429. Back off ~1.5 s + jitter and
        // retry once. Any other error fails fast.
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
