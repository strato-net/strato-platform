import { BackendClient } from "../api/backendClient";
import { NodeClients } from "../api/client";
import { OAuthClient } from "../auth/oauth";
import { BaseScenario } from "./base";
import { runRateLimited } from "../concurrency";
import {
  ScenarioResult,
  TxMetric,
  TokenSaleScenarioConfig,
  AuthConfig,
  BalanceLoggingMode,
} from "../types";
import {
  takeBalanceSnapshot,
  formatSnapshot,
  formatDiff,
  diffObject,
  SnapshotTargets,
  BalanceSnapshot,
} from "../api/balanceSnapshot";

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

    // Dedupe OAuthClients by (clientId, username). Multiple BackendClients
    // mapped to the same Keycloak account share one bearer + one in-flight
    // refresh promise — required because Keycloak rate-limits per-user grants
    // (>1 in <1 s returns 400/429). See OAuthClient.fetchAndCache for the
    // single-flight + retry logic.
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

    // Warm up: M parallel grants (one per UNIQUE user). Different users hit
    // different Keycloak rate-limit buckets so this fans out cleanly.
    await Promise.all(
      [...oauthByUser.entries()].map(async ([key, oauth]) => {
        try {
          await oauth.init();
          await oauth.getToken();
        } catch (err: any) {
          console.warn(`[tokenSale] OAuth warmup failed for ${key}: ${err.message}`);
        }
      }),
    );

    // Build N BackendClients, round-robin across the M shared OAuthClients.
    const pool: BackendClient[] = [];
    for (let i = 0; i < cfg.concurrentUsers; i++) {
      const u = users[i % users.length];
      const oauth = oauthByUser.get(oauthKey(u.username))!;
      pool.push(new BackendClient(backendUrl, oauth));
    }

    console.log(
      `[tokenSale] OAuth: ${oauthByUser.size} unique account(s) shared across ` +
        `${pool.length} BackendClient(s)`,
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

    // Resolve balance-snapshot configuration up-front. Snapshots are limited
    // to the buy-metal leg — only that step actually moves tokens; the bridge
    // request leg merely posts a hash for an already-broadcast Ethereum tx.
    const logBalances: BalanceLoggingMode = cfg.logBalances ?? "none";
    const snapshotTargets: SnapshotTargets = {
      payTokenAddress: cfg.payTokenAddress,
      metalTokenAddress: cfg.metalTokenAddress,
      metalForgeAddress: cfg.metalForgeAddress ?? "c5ed981b816a626981a5747d125e0e7296b2c7c6",
    };
    const snapshotsEnabled = logBalances !== "none" && willBuy;
    const perStepBalances = snapshotsEnabled && logBalances === "perStep";

    if (perStepBalances) {
      console.warn(
        `[tokenSale] logBalances=perStep — adds ~6 GETs of overhead per sale ` +
          `(payToken / metalToken / vouchers x buyer + payToken / metalToken x MetalForge ` +
          `+ /metal-forge/configs). Set logBalances: "summary" or "none" for max throughput.`,
      );
    }

    // ---- Pre-run snapshot (sampled from client[0]) ----
    let preRunSnap: BalanceSnapshot | null = null;
    if (snapshotsEnabled && this.backendClients[0]) {
      try {
        preRunSnap = await takeBalanceSnapshot(this.backendClients[0], snapshotTargets);
        console.log(`[tokenSale] ${formatSnapshot("pre-run [user 0]", preRunSnap)}`);
      } catch (err: any) {
        console.warn(`[tokenSale] pre-run snapshot failed: ${err.message}`);
      }
    }

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

        // --- buy-metal step (with optional per-step balance bracketing) ---
        if (willBuy && buyBody) {
          let stepBefore: BalanceSnapshot | null = null;
          if (perStepBalances) {
            try {
              stepBefore = await takeBalanceSnapshot(client, snapshotTargets);
            } catch (err: any) {
              console.warn(`[tokenSale] sale #${i}: pre-step snapshot failed: ${err.message}`);
            }
          }

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

          if (perStepBalances && stepBefore) {
            let stepAfter: BalanceSnapshot | null = null;
            try {
              stepAfter = await takeBalanceSnapshot(client, snapshotTargets);
            } catch (err: any) {
              console.warn(`[tokenSale] sale #${i}: post-step snapshot failed: ${err.message}`);
            }
            if (stepAfter) {
              // Surface buy-metal error / response body when the call failed —
              // load tests are useless without knowing why a request failed.
              const failureLine = ok
                ? ""
                : `\n    httpStatus=${res.status} respErr=${res.error ?? "?"} ` +
                  `respBody=${JSON.stringify(data).slice(0, 600)}`;
              console.log(
                `[tokenSale] sale #${i} user=${i % this.backendClients.length} status=${ok ? "ok" : "fail"}` +
                  failureLine + "\n" +
                  `    ${formatSnapshot("before", stepBefore)}\n` +
                  `    ${formatSnapshot("after ", stepAfter)}\n` +
                  `    ${formatDiff(stepBefore, stepAfter)}`,
              );
              // Attach diff to the buy-metal metric so it lands in the JSON report.
              const lastMetric = txMetrics[txMetrics.length - 1];
              if (lastMetric) {
                (lastMetric as any).balanceDiff = diffObject(stepBefore, stepAfter);
              }
            }
          }
        }

        if (this.verbose && i % 50 === 0 && !perStepBalances) {
          const lastMetric = txMetrics[txMetrics.length - 1];
          this.log(
            `sale #${i}: ${lastMetric?.status} ${lastMetric?.submitDuration}ms ` +
              `(last=${lastMetric?.scenario})`,
          );
        }
      },
    );
    const runEnd = Date.now();

    // ---- Post-run snapshot ----
    if (snapshotsEnabled && this.backendClients[0]) {
      try {
        const postRunSnap = await takeBalanceSnapshot(
          this.backendClients[0],
          snapshotTargets,
        );
        console.log(`[tokenSale] ${formatSnapshot("post-run [user 0]", postRunSnap)}`);
        if (preRunSnap) {
          console.log(`[tokenSale] run-aggregate ${formatDiff(preRunSnap, postRunSnap)}`);
        }
      } catch (err: any) {
        console.warn(`[tokenSale] post-run snapshot failed: ${err.message}`);
      }
    }

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
