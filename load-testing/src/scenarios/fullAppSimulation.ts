import { BaseScenario } from "./base";
import { NodeClients } from "../api/client";
import { BackendClient } from "../api/backendClient";
import { OAuthClient } from "../auth/oauth";
import { runForDuration } from "../concurrency";
import {
  ScenarioResult,
  TxMetric,
  AuthConfig,
  FullAppScenarioConfig,
  FullAppWorkflowStep,
} from "../types";

/**
 * Default workflow — approximates a realistic Mercata user session based on
 * routes defined in mercata/backend/src/api/routes/. Each step has light
 * think time to mimic human interaction.
 */
const DEFAULT_WORKFLOW: FullAppWorkflowStep[] = [
  { name: "home", method: "GET", path: "/", auth: false, thinkTimeMs: 300 },
  { name: "listTokens", method: "GET", path: "/api/tokens", auth: true, thinkTimeMs: 400 },
  { name: "balance", method: "GET", path: "/api/tokens/balance", auth: true, thinkTimeMs: 400 },
  { name: "config", method: "GET", path: "/api/config", auth: true, thinkTimeMs: 200 },
  { name: "voucherBalance", method: "GET", path: "/api/vouchers/balance", auth: true, thinkTimeMs: 200 },
  // Fund page GETs (bridge-in tab on /dashboard/deposits).
  { name: "networkConfigs", method: "GET", path: "/api/bridge/networkConfigs", auth: true, thinkTimeMs: 200 },
  { name: "depositActions", method: "GET", path: "/api/bridge/depositActions", auth: true, thinkTimeMs: 200 },
  { name: "bridgeableTokens", method: "GET", path: "/api/bridge/bridgeableTokens/1", auth: true, thinkTimeMs: 300 },
  { name: "metalForgeConfigs", method: "GET", path: "/api/metal-forge/configs", auth: true, thinkTimeMs: 400 },
  // Purchase step mirrors the Mercata UI's Buy-Metals call (USDST -> metal).
  {
    name: "purchase",
    method: "POST",
    path: "/api/metal-forge/buy",
    auth: true,
    body: {
      metalToken: "{metalTokenAddress}",
      payToken: "{payTokenAddress}",
      payAmount: "{payAmount}",
      minMetalOut: "{minMetalOut}",
    },
    thinkTimeMs: 800,
  },
  { name: "events", method: "GET", path: "/api/events", auth: true, thinkTimeMs: 400 },
];

/**
 * Scenario 3 — Full application simulation.
 *
 * Each virtual user walks through a multi-step workflow (home -> browse ->
 * balance -> purchase -> history) against @mercata/ui & @mercata/backend.
 * Steps with body placeholders can reference values from `config.context`
 * to substitute at runtime (e.g. {tokenAddress}).
 */
export class FullAppSimulationScenario extends BaseScenario {
  name(): string {
    return "fullApp";
  }

  private interpolate(value: any, ctx: Record<string, string>): any {
    if (typeof value === "string") {
      return value.replace(/\{(\w+)\}/g, (_match, key) => ctx[key] ?? `{${key}}`);
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.interpolate(v, ctx));
    }
    if (value && typeof value === "object") {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(value)) out[k] = this.interpolate(v, ctx);
      return out;
    }
    return value;
  }

  private buildClientPool(
    cfg: FullAppScenarioConfig,
    fallback: AuthConfig,
  ): { pool: BackendClient[]; oauthByUser: Map<string, OAuthClient> } {
    const users =
      cfg.users && cfg.users.length > 0
        ? cfg.users
        : [{ username: fallback.username, password: fallback.password }];
    const discoveryUrl = cfg.openIdDiscoveryUrl || fallback.openIdDiscoveryUrl;
    const clientId = cfg.clientId || fallback.clientId;
    const clientSecret = cfg.clientSecret || fallback.clientSecret;

    // Dedupe OAuthClients by (clientId, username). Multiple BackendClients
    // mapped to the same Keycloak account share one bearer + one in-flight
    // refresh promise — required because Keycloak rate-limits per-user grants.
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

    const pool: BackendClient[] = [];
    for (let i = 0; i < cfg.concurrentUsers; i++) {
      const u = users[i % users.length];
      const oauth = oauthByUser.get(oauthKey(u.username))!;
      pool.push(new BackendClient(cfg.baseUrl, oauth));
    }
    return { pool, oauthByUser };
  }

  async run(clients: NodeClients): Promise<ScenarioResult> {
    const cfg = this.config.scenarios.fullApp;
    const node = this.config.nodes[0];
    const workflow = cfg.workflow && cfg.workflow.length > 0 ? cfg.workflow : DEFAULT_WORKFLOW;

    const { pool, oauthByUser } = this.buildClientPool(cfg, node.auth);
    console.log(
      `[fullApp] ${cfg.concurrentUsers} users for ${cfg.durationMs}ms against ${cfg.baseUrl} ` +
        `(${workflow.length} steps, ${oauthByUser.size} unique OAuth account(s))`,
    );

    // Warm up: M parallel grants (one per UNIQUE Keycloak account). Each
    // BackendClient just borrows the cached bearer.
    await Promise.all(
      [...oauthByUser.entries()].map(async ([key, oauth]) => {
        try {
          await oauth.init();
          await oauth.getToken();
        } catch (err: any) {
          console.warn(`[fullApp] OAuth warmup failed for ${key}: ${err.message}`);
        }
      }),
    );

    const ctx: Record<string, string> = {
      // Token / purchase context sourced from the tokenSale scenario config so
      // both scenarios can share a single set of addresses in the YAML.
      tokenAddress: this.config.scenarios.tokenSale.payTokenAddress,
      metalTokenAddress: this.config.scenarios.tokenSale.metalTokenAddress,
      payTokenAddress: this.config.scenarios.tokenSale.payTokenAddress,
      payAmount: this.config.scenarios.tokenSale.payAmount || "1000000000000000",
      minMetalOut: this.config.scenarios.tokenSale.minMetalOut || "0",
      recipientAddress: "0000000000000000000000000000000000000001",
      amountPerTx: this.config.scenarios.tokenSale.payAmount || "1000000000000000",
    };

    const nodeName = clients.nodeName;
    const scenario = this.name();
    const txMetrics: TxMetric[] = [];

    const runStart = Date.now();
    await runForDuration(
      cfg.concurrentUsers,
      cfg.durationMs,
      async (userId, iteration) => {
        if (cfg.iterationsPerUser && iteration >= cfg.iterationsPerUser) return;

        const client = pool[userId % pool.length];
        for (const step of workflow) {
          if (step.thinkTimeMs && step.thinkTimeMs > 0) {
            await new Promise((r) => setTimeout(r, step.thinkTimeMs));
          }

          const body = step.body ? this.interpolate(step.body, ctx) : undefined;
          const query = step.query ? (this.interpolate(step.query, ctx) as any) : undefined;
          const submitTime = Date.now();
          const res = await client.request(step.method, step.path, {
            body,
            query,
            auth: step.auth === true,
          });
          const success = res.status >= 200 && res.status < 400;

          txMetrics.push(
            this.recordStep({
              nodeName,
              scenario: `${scenario}:${step.name}`,
              parentScenario: scenario,
              userId,
              iteration,
              step: step.name,
              submitTime,
              durationMs: res.durationMs,
              statusCode: res.status,
              success,
              error: res.error,
            }),
          );
        }
      },
    );
    const runEnd = Date.now();

    const ok = txMetrics.filter((m) => m.status === "confirmed").length;
    const failed = txMetrics.filter((m) => m.status === "failed").length;
    const elapsedSec = (runEnd - runStart) / 1000;

    console.log(
      `[fullApp] Done. ${ok} steps ok, ${failed} failed across ${elapsedSec.toFixed(2)}s ` +
        `(${(txMetrics.length / Math.max(elapsedSec, 0.001)).toFixed(2)} req/s)`,
    );

    return {
      scenario,
      nodeName,
      transactions: txMetrics,
      batches: [],
    };
  }

  private recordStep(args: {
    nodeName: string;
    scenario: string;
    parentScenario: string;
    userId: number;
    iteration: number;
    step: string;
    submitTime: number;
    durationMs: number;
    statusCode: number;
    success: boolean;
    error?: string;
  }): TxMetric {
    const metric: TxMetric = {
      txHash: `app:${args.step}:${args.userId}:${args.iteration}:${args.submitTime}`,
      nodeName: args.nodeName,
      scenario: args.scenario,
      batchIndex: args.userId,
      submitTime: args.submitTime,
      submitDuration: args.durationMs,
      confirmTime: args.submitTime + args.durationMs,
      confirmDuration: 0,
      totalDuration: args.durationMs,
      status: args.success ? "confirmed" : "failed",
      error: args.success ? undefined : `HTTP ${args.statusCode}: ${args.error ?? "unknown"}`,
    };
    this.collector.recordTx(metric);
    return metric;
  }
}