import { BackendClient, BackendRequestResult } from "../api/backendClient";
import { OAuthClient } from "../auth/oauth";
import { BaseScenario } from "./base";
import { TxMetric, AuthConfig, LoadTestUser } from "../types";

/**
 * Subset of a scenario config needed to initialise the BackendClient pool —
 * the auth fields plus `concurrentUsers` and an optional `backendUrl`
 * override. Each application-layer scenario's config interface is a
 * superset of this.
 */
export interface BackendUserPoolConfig {
  backendUrl?: string;
  concurrentUsers: number;
  users?: LoadTestUser[];
  openIdDiscoveryUrl?: string;
  clientId?: string;
  clientSecret?: string;
}

/**
 * Common base class for application-layer scenarios that authenticate
 * through Keycloak and hit the Mercata backend over HTTPS (e.g. tokenSale,
 * forgeBuy).
 *
 * Owns:
 *   - The BackendClient pool (OAuth-deduped per username, sized by
 *     `concurrentUsers`).
 *   - A generic page-load warmup helper that takes the list of GETs the
 *     relevant UI page fires on mount.
 *   - A POST-with-bounded-retry helper and a per-request metric recorder.
 *
 * Doesn't own:
 *   - The per-iteration scenario logic (subclasses provide that).
 *   - Any STRATO-specific submit/poll loops or Sepolia broadcaster wiring
 *     (those live in subclasses or dedicated helpers).
 */
export abstract class AppScenario extends BaseScenario {
  protected backendClients: BackendClient[] = [];
  /** Parallel array to `backendClients`: the Keycloak username each
   *  BackendClient is authenticated as. Lets `getUniqueUsers()` produce a
   *  per-user view without re-walking the OAuth dedupe logic. */
  protected backendClientUsernames: string[] = [];

  /**
   * Build the BackendClient pool. Multiple BackendClients mapped to the
   * same Keycloak account share one OAuthClient (and thus one bearer +
   * one in-flight refresh promise) — required because Keycloak rate-limits
   * per-user grants (>1 in <1 s returns 400/429). See
   * OAuthClient.fetchAndCache for the single-flight + retry logic.
   */
  protected async initClientPool(
    cfg: BackendUserPoolConfig,
    fallback: { backendUrl: string; auth: AuthConfig },
    scenarioLabel: string,
  ): Promise<void> {
    const backendUrl = (cfg.backendUrl || fallback.backendUrl).replace(/\/$/, "");
    const users =
      cfg.users && cfg.users.length > 0
        ? cfg.users
        : [{ username: fallback.auth.username, password: fallback.auth.password }];

    const discoveryUrl = cfg.openIdDiscoveryUrl || fallback.auth.openIdDiscoveryUrl;
    const clientId = cfg.clientId || fallback.auth.clientId;
    const clientSecret = cfg.clientSecret || fallback.auth.clientSecret;

    const oauthByUser = new Map<string, OAuthClient>();
    const oauthKey = (username: string) => `${clientId}::${username}`;
    for (const u of users) {
      const key = oauthKey(u.username);
      if (!oauthByUser.has(key)) {
        oauthByUser.set(
          key,
          new OAuthClient({
            openIdDiscoveryUrl: discoveryUrl,
            clientId,
            clientSecret,
            username: u.username,
            password: u.password,
          }),
        );
      }
    }

    // Warm up: one grant per UNIQUE user, throttled to ~20 grants/sec.
    //
    // Firing all grants in parallel overruns Keycloak's global / per-IP /
    // per-client throughput limit (distinct from its per-user limit): the
    // proxy in front of Keycloak returns an HTML error page for the overflow,
    // and simple-oauth2/@hapi/wreck throws "The content-type is not JSON
    // compatible". Spacing the grants ~50ms apart keeps the aggregate rate
    // under that ceiling. Grants are independent, so a small fixed delay
    // between sequential launches is enough — no need for a global gate here.
    const GRANT_SPACING_MS = 50; // ~20 grants/sec
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (const [key, oauth] of oauthByUser.entries()) {
      try {
        await oauth.init();
        await oauth.getToken();
      } catch (err: any) {
        console.warn(
          `[${scenarioLabel}] OAuth warmup failed for ${key}: ${err.message}`,
        );
      }
      await sleep(GRANT_SPACING_MS);
    }

    // Build N BackendClients, round-robin across the M shared OAuthClients.
    const pool: BackendClient[] = [];
    const usernamePool: string[] = [];
    for (let i = 0; i < cfg.concurrentUsers; i++) {
      const u = users[i % users.length];
      const oauth = oauthByUser.get(oauthKey(u.username))!;
      pool.push(new BackendClient(backendUrl, oauth));
      usernamePool.push(u.username);
    }

    console.log(
      `[${scenarioLabel}] OAuth: ${oauthByUser.size} unique account(s) shared across ` +
        `${pool.length} BackendClient(s)`,
    );

    this.backendClients = pool;
    this.backendClientUsernames = usernamePool;
  }

  /**
   * Return one entry per unique Keycloak account in the pool, picking the
   * first BackendClient mapped to each. Used by per-user balance snapshot
   * code so we read each user's auth-filtered balances exactly once instead
   * of redundantly through every BackendClient sharing the same account.
   */
  protected getUniqueUsers(): Array<{ client: BackendClient; username: string }> {
    const seen = new Set<string>();
    const out: Array<{ client: BackendClient; username: string }> = [];
    for (let i = 0; i < this.backendClients.length; i++) {
      const username = this.backendClientUsernames[i];
      if (seen.has(username)) continue;
      seen.add(username);
      out.push({ client: this.backendClients[i], username });
    }
    return out;
  }

  /**
   * Replay a fixed list of GETs once per BackendClient, in parallel across
   * clients but sequentially per-client. Mirrors the GETs the UI fires when
   * a user lands on the relevant page (Fund / Buy / etc.). Each step is
   * recorded as a metric scoped under
   * `${scenarioLabel}:pageLoad:${step.name}` so the report breaks them out
   * separately.
   */
  protected async runPageWarmup(args: {
    steps: Array<{ name: string; path: string }>;
    scenarioLabel: string;
    txMetrics: TxMetric[];
    nodeName: string;
  }): Promise<void> {
    if (this.backendClients.length === 0 || args.steps.length === 0) return;
    const { steps, scenarioLabel, txMetrics, nodeName } = args;
    const node = this.config.nodes[0];
    console.log(
      `[${scenarioLabel}] Page-load warmup for ${this.backendClients.length} users ` +
        `(${steps.length} GETs each against ${node.url})`,
    );
    await Promise.all(
      this.backendClients.map((c, idx) =>
        this.runOneClientWarmup(
          c,
          steps,
          idx,
          txMetrics,
          nodeName,
          scenarioLabel,
        ).catch((err) => {
          console.warn(
            `[${scenarioLabel}] page-load failed for user ${idx}: ${err.message}`,
          );
        }),
      ),
    );
  }

  private async runOneClientWarmup(
    client: BackendClient,
    steps: Array<{ name: string; path: string }>,
    userId: number,
    txMetrics: TxMetric[],
    nodeName: string,
    scenarioLabel: string,
  ): Promise<void> {
    for (const step of steps) {
      const submitTime = Date.now();
      const res = await client.request("GET", step.path, { auth: true });
      const ok = res.status >= 200 && res.status < 400;
      this.recordRequestMetric({
        txMetrics,
        nodeName,
        scenario: `${scenarioLabel}:pageLoad:${step.name}`,
        userId,
        submitTime,
        res,
        success: ok,
        hashOverride: `${scenarioLabel}:pageLoad:${step.name}:${userId}`,
      });
    }
  }

  /**
   * POST with bounded retry-on-transient-error. Retries up to `maxRetries`
   * times on HTTP 429 or any 5xx. Backoff between attempts is exponential
   * with ±0..500 ms jitter:
   *   attempt 2 fires after  ~1500 ms
   *   attempt 3 fires after  ~3000 ms
   *   attempt 4 fires after  ~6000 ms
   * The returned `durationMs` is the END-TO-END wall clock from the first
   * attempt's start to the final response (so a single metric reflects what
   * the user actually waited).
   *
   * Body-level "failure" responses (HTTP 200 with `{ status: "failure" }`)
   * are NOT retried — those are usually deterministic application errors,
   * not transient infrastructure issues.
   */
  protected async postWithRetry(args: {
    client: BackendClient;
    path: string;
    body: any;
    legName: string;
    iterationIdx: number;
    maxRetries: number;
    scenarioLabel: string;
  }): Promise<BackendRequestResult> {
    const startTime = Date.now();
    let lastRes: BackendRequestResult | null = null;
    for (let attempt = 0; attempt <= args.maxRetries; attempt++) {
      lastRes = await args.client.request("POST", args.path, {
        body: args.body,
        auth: true,
      });
      const isRetryable =
        lastRes.status === 429 ||
        (lastRes.status >= 500 && lastRes.status < 600);
      const isLastAttempt = attempt === args.maxRetries;
      if (!isRetryable || isLastAttempt) {
        return { ...lastRes, durationMs: Date.now() - startTime };
      }
      const delay = 1500 * Math.pow(2, attempt) + Math.floor(Math.random() * 500);
      console.log(
        `[${args.scenarioLabel}] ${args.legName} #${args.iterationIdx} got HTTP ${lastRes.status}, ` +
          `retrying in ${delay}ms (attempt ${attempt + 2}/${args.maxRetries + 1})`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
    return { ...(lastRes as BackendRequestResult), durationMs: Date.now() - startTime };
  }

  /**
   * Record a single backend HTTP request as a TxMetric in both the local
   * `txMetrics` array and the parent MetricsCollector. The metric's
   * `submitDuration` is the request wall-clock; `confirmDuration` is 0 since
   * the application-layer scenarios don't poll for terminal status (the
   * backend reply is itself the answer).
   */
  protected recordRequestMetric(args: {
    txMetrics: TxMetric[];
    nodeName: string;
    scenario: string;
    userId: number;
    submitTime: number;
    res: { status: number; durationMs: number; error?: string; data?: any };
    success: boolean;
    hashOverride: string;
  }): void {
    const { res } = args;
    const metric: TxMetric = {
      txHash: args.hashOverride,
      nodeName: args.nodeName,
      scenario: args.scenario,
      batchIndex: args.userId,
      submitTime: args.submitTime,
      submitDuration: res.durationMs,
      confirmTime: args.submitTime + res.durationMs,
      confirmDuration: 0,
      totalDuration: res.durationMs,
      status: args.success ? "confirmed" : "failed",
      error: args.success ? undefined : res.error ?? `HTTP ${res.status}`,
    };
    this.collector.recordTx(metric);
    args.txMetrics.push(metric);
  }
}
