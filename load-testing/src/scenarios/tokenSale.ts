import { BackendClient } from "../api/backendClient";
import { NodeClients } from "../api/client";
import { BaseScenario } from "./base";
import { runRateLimited } from "../concurrency";
import {
  ScenarioResult,
  TxMetric,
  TokenSaleScenarioConfig,
  AuthConfig,
} from "../types";

/**
 * Scenario 1 — Token Sale TPS.
 *
 * Replays the "Fund > Bridge-In USDC (Ethereum) → GOLDST (STRATO)" flow
 * performed by the Mercata UI in
 * mercata/ui/src/pages/DepositsPage.tsx + components/bridge/BridgeIn.tsx.
 *
 * Per the UI trace (see BridgeIn.handleBridge + handleBuyMetals):
 *   Page-load GETs (once per user, gated by includePageLoad):
 *     - GET /api/bridge/networkConfigs
 *     - GET /api/bridge/depositActions
 *     - GET /api/bridge/bridgeableTokens/{externalChainId}
 *     - GET /api/metal-forge/configs
 *
 *   Per-iteration POSTs:
 *     - POST /api/bridge/requestDepositAction   (action=2, AUTO_FORGE)
 *     - POST /api/metal-forge/buy               (USDST -> metal on STRATO)
 *
 * The Ethereum-side Permit2 approve + DepositRouter.deposit are not replayed
 * per iteration — they burn real gas and real block time. Point
 * externalTxHash at a previously-broadcast Sepolia/Ethereum tx hash, or leave
 * skipBridgeRequest=true to exercise only the /metal-forge/buy leg.
 *
 * TPS is measured over both legs combined (what the UI treats as a single
 * "sale" from the user's perspective).
 */
export class TokenSaleScenario extends BaseScenario {
  private backendClients: BackendClient[] = [];

  name(): string {
    return "tokenSale";
  }

  private async initClientPool(
    cfg: TokenSaleScenarioConfig,
    fallback: { backendUrl: string; auth: AuthConfig },
  ): Promise<void> {
    const backendUrl = (cfg.backendUrl || fallback.backendUrl).replace(/\/$/, "");
    const users =
      cfg.users && cfg.users.length > 0
        ? cfg.users
        : [{ username: fallback.auth.username, password: fallback.auth.password }];

    const discoveryUrl = cfg.openIdDiscoveryUrl || fallback.auth.openIdDiscoveryUrl;
    const clientId = cfg.clientId || fallback.auth.clientId;
    const clientSecret = cfg.clientSecret || fallback.auth.clientSecret;

    const pool: BackendClient[] = [];
    for (let i = 0; i < cfg.concurrentUsers; i++) {
      const u = users[i % users.length];
      const authCfg: AuthConfig = {
        openIdDiscoveryUrl: discoveryUrl,
        clientId,
        clientSecret,
        username: u.username,
        password: u.password,
      };
      pool.push(new BackendClient(backendUrl, authCfg));
    }

    // Warm up all clients (OAuth discovery + first token fetch) in parallel.
    await Promise.all(
      pool.map(async (c, idx) => {
        try {
          await c.init();
          await c.getToken();
        } catch (err: any) {
          console.warn(
            `[tokenSale] Warmup failed for client #${idx}: ${err.message}`,
          );
        }
      }),
    );

    this.backendClients = pool;
  }

  /** Fund-page GETs. Each user does these once before the per-iteration POSTs. */
  private async runPageLoad(
    client: BackendClient,
    externalChainId: string,
    userId: number,
    txMetrics: TxMetric[],
    nodeName: string,
    scenario: string,
  ): Promise<void> {
    const steps: Array<{ name: string; path: string }> = [
      { name: "networkConfigs", path: "/api/bridge/networkConfigs" },
      { name: "depositActions", path: "/api/bridge/depositActions" },
      { name: "bridgeableTokens", path: `/api/bridge/bridgeableTokens/${externalChainId}` },
      { name: "metalForgeConfigs", path: "/api/metal-forge/configs" },
    ];

    for (const step of steps) {
      const submitTime = Date.now();
      const res = await client.request("GET", step.path, { auth: true });
      const ok = res.status >= 200 && res.status < 400;
      this.recordRequestMetric({
        txMetrics,
        nodeName,
        scenario: `${scenario}:pageLoad:${step.name}`,
        userId,
        iteration: 0,
        submitTime,
        res,
        success: ok,
        hashOverride: `${scenario}:pageLoad:${step.name}:${userId}`,
      });
    }
  }

  private buildBridgeRequestBody(cfg: TokenSaleScenarioConfig) {
    const body: Record<string, any> = {
      externalChainId: cfg.externalChainId ?? "1",
      externalTxHash: cfg.externalTxHash ?? "",
      action: cfg.action ?? 2,
    };
    // action=2 (AUTO_FORGE) needs targetToken; action=1 (AUTO_SAVE) omits it.
    if ((cfg.action ?? 2) === 2 && cfg.metalTokenAddress) {
      body.targetToken = cfg.metalTokenAddress;
    }
    return body;
  }

  private buildBuyMetalBody(cfg: TokenSaleScenarioConfig) {
    return {
      metalToken: cfg.metalTokenAddress,
      payToken: cfg.payTokenAddress,
      payAmount: cfg.payAmount,
      minMetalOut: cfg.minMetalOut ?? "0",
    };
  }

  async run(clients: NodeClients): Promise<ScenarioResult> {
    const cfg = this.config.scenarios.tokenSale;
    const node = this.config.nodes[0];

    const willBridge =
      cfg.skipBridgeRequest !== true && !!cfg.externalTxHash && cfg.externalTxHash.length > 0;
    const willBuy = cfg.skipBuyMetal !== true;

    if (!willBridge && !willBuy) {
      throw new Error(
        "tokenSale: nothing to do — both bridge request and buy-metal are disabled",
      );
    }
    if (willBuy && !cfg.metalTokenAddress) {
      throw new Error("tokenSale: metalTokenAddress is required when skipBuyMetal is false");
    }
    if (willBuy && !cfg.payTokenAddress) {
      throw new Error("tokenSale: payTokenAddress is required when skipBuyMetal is false");
    }
    if (willBridge && !cfg.metalTokenAddress && (cfg.action ?? 2) === 2) {
      throw new Error(
        "tokenSale: metalTokenAddress is required for action=2 (AUTO_FORGE) bridge requests",
      );
    }

    await this.initClientPool(cfg, { backendUrl: node.url, auth: node.auth });

    const nodeName = clients.nodeName;
    const scenario = this.name();
    const txMetrics: TxMetric[] = [];

    // Optional page-load warmup per user.
    if (cfg.includePageLoad) {
      console.log(
        `[tokenSale] Page-load warmup for ${this.backendClients.length} users ` +
          `(4 GETs each against ${node.url})`,
      );
      await Promise.all(
        this.backendClients.map((c, idx) =>
          this.runPageLoad(
            c,
            cfg.externalChainId ?? "1",
            idx,
            txMetrics,
            nodeName,
            scenario,
          ).catch((err) => {
            console.warn(`[tokenSale] page-load failed for user ${idx}: ${err.message}`);
          }),
        ),
      );
    }

    const bridgeBody = willBridge ? this.buildBridgeRequestBody(cfg) : null;
    const buyBody = willBuy ? this.buildBuyMetalBody(cfg) : null;

    console.log(
      `[tokenSale] ${cfg.totalTxCount} sales (bridge=${willBridge} buy=${willBuy}) ` +
        `across ${cfg.concurrentUsers} users over ${cfg.timeWindowMs}ms ` +
        `-> ${node.url} (network=${cfg.networkLabel ?? "?"})`,
    );

    const runStart = Date.now();
    await runRateLimited(
      cfg.totalTxCount,
      cfg.timeWindowMs,
      cfg.concurrentUsers,
      async (i: number) => {
        const client = this.backendClients[i % this.backendClients.length];

        // --- bridge request step ---
        if (willBridge && bridgeBody) {
          const submitTime = Date.now();
          const res = await client.request("POST", "/api/bridge/requestDepositAction", {
            body: bridgeBody,
            auth: true,
          });
          const data = res.data ?? {};
          const reported = data?.data?.status ?? data?.status;
          const hash = data?.data?.hash ?? data?.hash ?? `bridgeReq:${i}`;
          const ok =
            res.status >= 200 &&
            res.status < 300 &&
            (reported === undefined || reported === "success" || reported === "Success");
          this.recordRequestMetric({
            txMetrics,
            nodeName,
            scenario: `${scenario}:bridgeRequest`,
            userId: i,
            iteration: 0,
            submitTime,
            res,
            success: ok,
            hashOverride: hash,
          });
        }

        // --- buy-metal step ---
        if (willBuy && buyBody) {
          const submitTime = Date.now();
          const res = await client.request("POST", "/api/metal-forge/buy", {
            body: buyBody,
            auth: true,
          });
          const data = res.data ?? {};
          const hash = data?.hash ?? data?.data?.hash ?? `buyMetal:${i}`;
          const txStatus: string | undefined = data?.status ?? data?.data?.status;
          const ok =
            res.status >= 200 &&
            res.status < 300 &&
            (txStatus === "Success" || txStatus === "success" || !!data?.hash);
          this.recordRequestMetric({
            txMetrics,
            nodeName,
            scenario: `${scenario}:buyMetal`,
            userId: i,
            iteration: 0,
            submitTime,
            res,
            success: ok,
            hashOverride: hash,
          });
        }

        if (this.verbose && i % 50 === 0) {
          const lastMetric = txMetrics[txMetrics.length - 1];
          this.log(
            `sale #${i}: ${lastMetric?.status} ${lastMetric?.submitDuration}ms ` +
              `(last=${lastMetric?.scenario})`,
          );
        }
      },
    );
    const runEnd = Date.now();

    // Aggregate sale-level stats. A "sale" here is: 1 bridgeRequest + 1
    // buyMetal call (or whichever subset is enabled). Count the successes
    // across the leg(s) that ran.
    const elapsedSec = (runEnd - runStart) / 1000;
    const callsPerSale = (willBridge ? 1 : 0) + (willBuy ? 1 : 0);
    const coreMetrics = txMetrics.filter(
      (m) =>
        m.scenario === `${scenario}:bridgeRequest` ||
        m.scenario === `${scenario}:buyMetal`,
    );
    const confirmed = coreMetrics.filter((m) => m.status === "confirmed").length;
    const failed = coreMetrics.filter((m) => m.status === "failed").length;
    const salesAttempted = Math.floor(coreMetrics.length / Math.max(callsPerSale, 1));
    const salesTps = salesAttempted / Math.max(elapsedSec, 0.001);
    const callTps = coreMetrics.length / Math.max(elapsedSec, 0.001);

    console.log(
      `[tokenSale] Done. calls: ${confirmed} confirmed, ${failed} failed in ` +
        `${elapsedSec.toFixed(2)}s — ${salesTps.toFixed(2)} sales/s (${callTps.toFixed(2)} calls/s)`,
    );

    return {
      scenario,
      nodeName,
      transactions: txMetrics,
      batches: [],
    };
  }

  private recordRequestMetric(args: {
    txMetrics: TxMetric[];
    nodeName: string;
    scenario: string;
    userId: number;
    iteration: number;
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
