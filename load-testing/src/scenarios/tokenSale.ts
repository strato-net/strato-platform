import { BackendClient, BackendRequestResult } from "../api/backendClient";
import { NodeClients } from "../api/client";
import { OAuthClient } from "../auth/oauth";
import { BaseScenario } from "./base";
import { runRateLimited, runBoundedConcurrent } from "../concurrency";
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
import { SepoliaBroadcaster, normalizeAddress0x } from "../tx/sepoliaBroadcast";

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
      externalChainId: cfg.externalChainId ?? "11155111",
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

    // Three legs may run per iteration. Their enablement is evaluated up-front:
    //   - willBroadcast : broadcast a fresh Sepolia DepositRouter.depositETH
    //                     per iteration (requires `bridge` sub-config)
    //   - willBridge    : POST /api/bridge/requestDepositAction (uses either
    //                     the per-iteration broadcast hash, or a static
    //                     externalTxHash, or both — broadcast wins)
    //   - willBuy       : POST /api/metal-forge/buy
    const willBroadcast =
      cfg.skipBridgeRequest !== true &&
      cfg.bridge !== undefined &&
      !!cfg.bridge.sepoliaRpcUrl;
    const willBridge =
      cfg.skipBridgeRequest !== true &&
      (willBroadcast ||
        (!!cfg.externalTxHash && cfg.externalTxHash.length > 0));
    const willBuy = cfg.skipBuyMetal !== true;

    if (!willBridge && !willBuy && !willBroadcast) {
      throw new Error(
        "tokenSale: nothing to do — broadcast, bridge request, and buy-metal are all disabled",
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
    if (willBroadcast && cfg.bridge) {
      const b = cfg.bridge;
      if (!b.sepoliaPrivateKey) throw new Error("tokenSale.bridge: sepoliaPrivateKey is required");
      if (!b.depositRouterAddress) throw new Error("tokenSale.bridge: depositRouterAddress is required");
      if (!b.stratoRecipientAddress) throw new Error("tokenSale.bridge: stratoRecipientAddress is required");
      if (!b.targetStratoToken) throw new Error("tokenSale.bridge: targetStratoToken is required");
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
            cfg.externalChainId ?? "11155111",
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

    const baseBridgeBody = willBridge ? this.buildBridgeRequestBody(cfg) : null;
    const buyBody = willBuy ? this.buildBuyMetalBody(cfg) : null;

    // ---- Bring up Sepolia broadcaster (lazy-imports ethers via the helper) ----
    let broadcaster: SepoliaBroadcaster | null = null;
    let broadcasterRecipient: string | null = null;
    let broadcasterTarget: string | null = null;
    let broadcasterAmount: string | null = null;
    if (willBroadcast && cfg.bridge) {
      const b = cfg.bridge;
      broadcaster = new SepoliaBroadcaster({
        rpcUrl: b.sepoliaRpcUrl,
        privateKey: b.sepoliaPrivateKey,
        depositRouterAddress: b.depositRouterAddress,
        chainId: b.chainId,
        gasLimit: b.gasLimit,
        maxFeePerGasGwei: b.maxFeePerGasGwei,
        maxPriorityFeePerGasGwei: b.maxPriorityFeePerGasGwei,
        startNonce: b.startNonce,
      });
      await broadcaster.init();
      broadcasterRecipient = normalizeAddress0x(b.stratoRecipientAddress);
      broadcasterTarget = normalizeAddress0x(b.targetStratoToken);
      broadcasterAmount = b.amountPerTx ?? "1000000000000";
      console.log(
        `[tokenSale] Sepolia broadcaster ready — wallet=${broadcaster.walletAddress} ` +
          `startNonce=${broadcaster.startNonce} amount=${broadcasterAmount} wei ` +
          `-> strato=${broadcasterRecipient} token=${broadcasterTarget} ` +
          `awaitConfirmation=${b.awaitConfirmation === true}`,
      );
    }

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

    // Decide how often to print per-iteration progress so the user always
    // sees liveness without drowning the console at high totalTxCount.
    // Log every iteration up to ~20; otherwise sample ~10 evenly-spaced lines.
    const progressStep = Math.max(1, Math.ceil(cfg.totalTxCount / 20));
    const shouldLogProgress = (i: number) =>
      this.verbose || i % progressStep === 0 || i === cfg.totalTxCount - 1;

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

    // ============================================================
    // Pipeline-mode branch — two phases with bounded concurrency
    // ============================================================
    const pipelineMode = cfg.pipelineMode === true;
    const sepoliaConcurrency = cfg.sepoliaConcurrency ?? cfg.concurrentUsers;
    const backendConcurrency = cfg.backendConcurrency ?? cfg.concurrentUsers;

    const runStart = Date.now();

    if (pipelineMode) {
      await this.runPipelined({
        cfg,
        broadcaster,
        broadcasterRecipient,
        broadcasterTarget,
        broadcasterAmount,
        baseBridgeBody,
        buyBody,
        willBroadcast,
        willBridge,
        willBuy,
        perStepBalances,
        snapshotTargets,
        sepoliaConcurrency,
        backendConcurrency,
        nodeName,
        scenario,
        txMetrics,
        shouldLogProgress,
      });
    } else await runRateLimited(
      cfg.totalTxCount,
      cfg.timeWindowMs,
      cfg.concurrentUsers,
      async (i: number) => {
        const client = this.backendClients[i % this.backendClients.length];

        // --- Sepolia broadcast leg (only when bridge config is set) ---
        // Each iteration broadcasts a fresh DepositRouter.depositETH with
        // nonce = startNonce + i. The resulting tx hash overrides the static
        // externalTxHash for this iteration's bridge-request body, so every
        // iteration represents a UNIQUE on-chain bridge entry.
        let perIterationTxHash: string | undefined;
        if (
          willBroadcast &&
          broadcaster &&
          broadcasterRecipient &&
          broadcasterTarget &&
          broadcasterAmount &&
          cfg.bridge
        ) {
          const submitTime = Date.now();
          const result = await broadcaster.broadcastDepositETH({
            nonceOffset: i,
            stratoRecipient: broadcasterRecipient,
            targetStratoToken: broadcasterTarget,
            amountWei: broadcasterAmount,
            awaitConfirmation: cfg.bridge.awaitConfirmation === true,
          });
          perIterationTxHash = result.txHash;

          const broadcastMetric: TxMetric = {
            txHash: result.txHash,
            nodeName,
            scenario: `${scenario}:sepoliaDeposit`,
            batchIndex: i,
            submitTime,
            submitDuration: result.submitDurationMs,
            confirmTime: submitTime + result.submitDurationMs + result.confirmDurationMs,
            confirmDuration: result.confirmDurationMs,
            totalDuration: result.submitDurationMs + result.confirmDurationMs,
            status: result.status,
            error: result.error,
          };
          this.collector.recordTx(broadcastMetric);
          txMetrics.push(broadcastMetric);

          if (shouldLogProgress(i) || result.status === "failed") {
            console.log(
              `[tokenSale] sepolia #${i} nonce=${broadcaster.startNonce + i} ` +
                `${result.status} ${result.txHash.substring(0, 18)}... ` +
                `submit=${result.submitDurationMs}ms confirm=${result.confirmDurationMs}ms ` +
                `${result.error ?? ""}`,
            );
          }

          // If the broadcast itself failed, skip the rest of the per-iteration
          // sequence — there's nothing meaningful to bridge or buy with.
          if (result.status === "failed") return;
        }

        // --- bridge request step ---
        if (willBridge && baseBridgeBody) {
          // If we just broadcast a fresh tx, use its hash; otherwise fall back
          // to the static externalTxHash already in baseBridgeBody.
          const bridgeBody = perIterationTxHash
            ? { ...baseBridgeBody, externalTxHash: perIterationTxHash }
            : baseBridgeBody;
          const submitTime = Date.now();
          const res = await this.postWithRetry({
            client,
            path: "/api/bridge/requestDepositAction",
            body: bridgeBody,
            legName: "bridgeRequest",
            iterationIdx: i,
            maxRetries: cfg.requestRetries ?? 3,
          });
          const data = res.data ?? {};
          const reported = data?.data?.status ?? data?.status;
          const hash = data?.data?.hash ?? data?.hash ?? `bridgeReq:${i}`;
          // Surface the response body when the bridge request fails — load
          // tests are useless without knowing why an upstream call rejected.
          // Common causes: bridge service down (Cloudflare 521 / 502),
          // duplicate-deposit-action ("already processed"), invalid externalTxHash.
          const bridgeOk =
            res.status >= 200 &&
            res.status < 300 &&
            (reported === undefined || reported === "success" || reported === "Success");
          if (!bridgeOk) {
            console.warn(
              `[tokenSale] bridgeRequest #${i} FAILED: httpStatus=${res.status} ` +
                `respErr=${res.error ?? "?"} ` +
                `body=${typeof res.data === "string" ? res.data.slice(0, 400) : JSON.stringify(res.data).slice(0, 400)}`,
            );
          } else if (shouldLogProgress(i)) {
            console.log(
              `[tokenSale] bridgeRequest #${i} ok ${res.durationMs}ms hash=${String(hash).substring(0, 18)}`,
            );
          }
          this.recordRequestMetric({
            txMetrics,
            nodeName,
            scenario: `${scenario}:bridgeRequest`,
            userId: i,
            iteration: 0,
            submitTime,
            res,
            success: bridgeOk,
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
          const res = await this.postWithRetry({
            client,
            path: "/api/metal-forge/buy",
            body: buyBody,
            legName: "buyMetal",
            iterationIdx: i,
            maxRetries: cfg.requestRetries ?? 3,
          });
          const data = res.data ?? {};
          const hash = data?.hash ?? data?.data?.hash ?? `buyMetal:${i}`;
          const txStatus: string | undefined = data?.status ?? data?.data?.status;
          const ok =
            res.status >= 200 &&
            res.status < 300 &&
            (txStatus === "Success" || txStatus === "success" || !!data?.hash);
          // Always log buy-metal failures (load tests are useless without
          // knowing why); sample successes via shouldLogProgress so the user
          // sees liveness even with logBalances=none.
          if (!ok) {
            console.warn(
              `[tokenSale] buyMetal #${i} FAILED: httpStatus=${res.status} ` +
                `respErr=${res.error ?? "?"} ` +
                `body=${typeof res.data === "string" ? res.data.slice(0, 400) : JSON.stringify(res.data).slice(0, 400)}`,
            );
          } else if (shouldLogProgress(i)) {
            console.log(
              `[tokenSale] buyMetal #${i} ok ${res.durationMs}ms hash=${String(hash).substring(0, 18)}`,
            );
          }
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

    // Aggregate sale-level stats. A "sale" is the sum of legs that ran:
    //   sepoliaDeposit (if willBroadcast) + bridgeRequest (if willBridge) +
    //   buyMetal (if willBuy). Count successes across all legs.
    const elapsedSec = (runEnd - runStart) / 1000;
    const callsPerSale =
      (willBroadcast ? 1 : 0) + (willBridge ? 1 : 0) + (willBuy ? 1 : 0);
    const coreMetrics = txMetrics.filter(
      (m) =>
        m.scenario === `${scenario}:sepoliaDeposit` ||
        m.scenario === `${scenario}:bridgeRequest` ||
        m.scenario === `${scenario}:buyMetal`,
    );
    const confirmed = coreMetrics.filter(
      (m) => m.status === "confirmed" || m.status === "submitted",
    ).length;
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

  /**
   * Two-phase pipelined run, used when `pipelineMode: true`.
   *
   * Phase 1: broadcast all N Sepolia DepositRouter.depositETH txs in parallel
   *          (bounded by `sepoliaConcurrency`). Captures successful tx hashes.
   * Phase 2: for each successful broadcast (or for all i when willBroadcast
   *          is false), fire bridgeRequest + buyMetal in series for that i,
   *          with up to `backendConcurrency` such pairs in parallel.
   *
   * Wall clock = max(slowest single broadcast) + max(slowest single backend
   * round-trip) instead of N × per-iteration latency.
   */
  private async runPipelined(args: {
    cfg: TokenSaleScenarioConfig;
    broadcaster: SepoliaBroadcaster | null;
    broadcasterRecipient: string | null;
    broadcasterTarget: string | null;
    broadcasterAmount: string | null;
    baseBridgeBody: any;
    buyBody: any;
    willBroadcast: boolean;
    willBridge: boolean;
    willBuy: boolean;
    perStepBalances: boolean;
    snapshotTargets: SnapshotTargets;
    sepoliaConcurrency: number;
    backendConcurrency: number;
    nodeName: string;
    scenario: string;
    txMetrics: TxMetric[];
    shouldLogProgress: (i: number) => boolean;
  }): Promise<void> {
    const {
      cfg,
      broadcaster,
      broadcasterRecipient,
      broadcasterTarget,
      broadcasterAmount,
      baseBridgeBody,
      buyBody,
      willBroadcast,
      willBridge,
      willBuy,
      perStepBalances,
      snapshotTargets,
      sepoliaConcurrency,
      backendConcurrency,
      nodeName,
      scenario,
      txMetrics,
      shouldLogProgress,
    } = args;

    // ---- Phase 1: broadcast all N concurrently ----
    const successfulBroadcasts = new Map<number, string>();
    if (willBroadcast && broadcaster && broadcasterRecipient && broadcasterTarget && broadcasterAmount && cfg.bridge) {
      console.log(
        `[tokenSale] Phase 1/2: broadcasting ${cfg.totalTxCount} Sepolia ` +
          `deposit(s) (concurrency=${sepoliaConcurrency}, awaitConfirmation=${cfg.bridge.awaitConfirmation === true})...`,
      );
      const phase1Start = Date.now();
      await runBoundedConcurrent(cfg.totalTxCount, sepoliaConcurrency, async (i: number) => {
        const submitTime = Date.now();
        const result = await broadcaster.broadcastDepositETH({
          nonceOffset: i,
          stratoRecipient: broadcasterRecipient,
          targetStratoToken: broadcasterTarget,
          amountWei: broadcasterAmount,
          awaitConfirmation: cfg.bridge!.awaitConfirmation === true,
        });

        const broadcastMetric: TxMetric = {
          txHash: result.txHash,
          nodeName,
          scenario: `${scenario}:sepoliaDeposit`,
          batchIndex: i,
          submitTime,
          submitDuration: result.submitDurationMs,
          confirmTime: submitTime + result.submitDurationMs + result.confirmDurationMs,
          confirmDuration: result.confirmDurationMs,
          totalDuration: result.submitDurationMs + result.confirmDurationMs,
          status: result.status,
          error: result.error,
        };
        this.collector.recordTx(broadcastMetric);
        txMetrics.push(broadcastMetric);

        if (shouldLogProgress(i) || result.status === "failed") {
          console.log(
            `[tokenSale] sepolia #${i} nonce=${broadcaster.startNonce + i} ` +
              `${result.status} ${result.txHash.substring(0, 18)}... ` +
              `submit=${result.submitDurationMs}ms confirm=${result.confirmDurationMs}ms ` +
              `${result.error ?? ""}`,
          );
        }

        if (result.status !== "failed") {
          successfulBroadcasts.set(i, result.txHash);
        }
      });
      const phase1Ms = Date.now() - phase1Start;
      console.log(
        `[tokenSale] Phase 1 done in ${(phase1Ms / 1000).toFixed(2)}s — ` +
          `${successfulBroadcasts.size}/${cfg.totalTxCount} broadcasts succeeded`,
      );
    }

    // ---- Phase 2: bridgeRequest + buyMetal pairs concurrently ----
    // When willBroadcast=false, run all i in [0, totalTxCount). Otherwise only
    // run the indices whose Sepolia broadcast succeeded.
    const phase2Indices = willBroadcast
      ? Array.from(successfulBroadcasts.keys()).sort((a, b) => a - b)
      : Array.from({ length: cfg.totalTxCount }, (_, i) => i);

    if (phase2Indices.length === 0) {
      console.log(`[tokenSale] Phase 2/2: skipped (no successful broadcasts).`);
      return;
    }

    console.log(
      `[tokenSale] Phase 2/2: ${phase2Indices.length} bridgeRequest+buyMetal ` +
        `pair(s) (concurrency=${backendConcurrency})...`,
    );
    const phase2Start = Date.now();
    await runBoundedConcurrent(phase2Indices.length, backendConcurrency, async (idx) => {
      const i = phase2Indices[idx];
      const client = this.backendClients[i % this.backendClients.length];
      const perIterationTxHash = successfulBroadcasts.get(i);

      // bridge request
      if (willBridge && baseBridgeBody) {
        const bridgeBody = perIterationTxHash
          ? { ...baseBridgeBody, externalTxHash: perIterationTxHash }
          : baseBridgeBody;
        const submitTime = Date.now();
        const res = await this.postWithRetry({
          client,
          path: "/api/bridge/requestDepositAction",
          body: bridgeBody,
          legName: "bridgeRequest",
          iterationIdx: i,
          maxRetries: cfg.requestRetries ?? 3,
        });
        const data = res.data ?? {};
        const reported = data?.data?.status ?? data?.status;
        const hash = data?.data?.hash ?? data?.hash ?? `bridgeReq:${i}`;
        const bridgeOk =
          res.status >= 200 &&
          res.status < 300 &&
          (reported === undefined || reported === "success" || reported === "Success");
        if (!bridgeOk) {
          console.warn(
            `[tokenSale] bridgeRequest #${i} FAILED: httpStatus=${res.status} ` +
              `respErr=${res.error ?? "?"} ` +
              `body=${typeof res.data === "string" ? res.data.slice(0, 400) : JSON.stringify(res.data).slice(0, 400)}`,
          );
        } else if (shouldLogProgress(i)) {
          console.log(
            `[tokenSale] bridgeRequest #${i} ok ${res.durationMs}ms hash=${String(hash).substring(0, 18)}`,
          );
        }
        this.recordRequestMetric({
          txMetrics,
          nodeName,
          scenario: `${scenario}:bridgeRequest`,
          userId: i,
          iteration: 0,
          submitTime,
          res,
          success: bridgeOk,
          hashOverride: hash,
        });
      }

      // buy metal (per-step balance snapshots intentionally skipped in
      // pipelineMode — they'd serialise the phase by adding 6 GETs/iter and
      // are usually not what you want at high concurrency)
      if (willBuy && buyBody) {
        const submitTime = Date.now();
        const res = await this.postWithRetry({
          client,
          path: "/api/metal-forge/buy",
          body: buyBody,
          legName: "buyMetal",
          iterationIdx: i,
          maxRetries: cfg.requestRetries ?? 3,
        });
        const data = res.data ?? {};
        const hash = data?.hash ?? data?.data?.hash ?? `buyMetal:${i}`;
        const txStatus: string | undefined = data?.status ?? data?.data?.status;
        const ok =
          res.status >= 200 &&
          res.status < 300 &&
          (txStatus === "Success" || txStatus === "success" || !!data?.hash);
        if (!ok) {
          console.warn(
            `[tokenSale] buyMetal #${i} FAILED: httpStatus=${res.status} ` +
              `respErr=${res.error ?? "?"} ` +
              `body=${typeof res.data === "string" ? res.data.slice(0, 400) : JSON.stringify(res.data).slice(0, 400)}`,
          );
        } else if (shouldLogProgress(i)) {
          console.log(
            `[tokenSale] buyMetal #${i} ok ${res.durationMs}ms hash=${String(hash).substring(0, 18)}`,
          );
        }
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

        // Silently note when perStepBalances was requested but suppressed.
        if (perStepBalances && idx === 0) {
          console.warn(
            `[tokenSale] pipelineMode + logBalances=perStep: per-step ` +
              `snapshots are suppressed under pipelineMode (would serialise ` +
              `the phase). Set logBalances=summary for run-level deltas.`,
          );
        }
      }
    });
    const phase2Ms = Date.now() - phase2Start;
    console.log(
      `[tokenSale] Phase 2 done in ${(phase2Ms / 1000).toFixed(2)}s`,
    );

    // Reference snapshotTargets to avoid TS6133 unused-parameter on the
    // pipelined branch (perStepBalances is intentionally not used here).
    void snapshotTargets;
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
  private async postWithRetry(args: {
    client: BackendClient;
    path: string;
    body: any;
    legName: string;
    iterationIdx: number;
    maxRetries: number;
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
      // Increasing backoff: 1500 * 2^attempt + jitter(0..500)
      const delay = 1500 * Math.pow(2, attempt) + Math.floor(Math.random() * 500);
      console.log(
        `[tokenSale] ${args.legName} #${args.iterationIdx} got HTTP ${lastRes.status}, ` +
          `retrying in ${delay}ms (attempt ${attempt + 2}/${args.maxRetries + 1})`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
    // Unreachable in practice (loop returns on isLastAttempt), but TS needs
    // a guaranteed return.
    return { ...(lastRes as BackendRequestResult), durationMs: Date.now() - startTime };
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
