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
  readCirrusBalance,
  formatSnapshot,
  formatDiff,
  SnapshotTargets,
  BalanceSnapshot,
} from "../api/balanceSnapshot";
import { SepoliaBroadcaster, normalizeAddress0x } from "../tx/sepoliaBroadcast";

/**
 * Scenario 1 — Token Sale TPS (canonical UI flow only).
 *
 * Replays the Mercata UI's "Fund > Bridge-In Ethereum Sepolia, Send USDC,
 * Receive GOLDST" composition from
 * mercata/ui/src/pages/DepositsPage.tsx + components/bridge/BridgeIn.tsx.
 *
 * Per UI trace (BridgeIn.handleBridge with AUTO_FORGE selected):
 *   Page-load GETs (once per user, gated by includePageLoad):
 *     - GET /api/bridge/networkConfigs
 *     - GET /api/bridge/depositActions
 *     - GET /api/bridge/bridgeableTokens/{externalChainId}
 *     - GET /api/metal-forge/configs
 *
 *   Per-iteration legs:
 *     1. Sign Permit2 PermitTransferFrom typed-data (EIP-712) for USDC.
 *     2. Submit DepositRouter.deposit(USDC, ..., signature) on Sepolia.
 *     3. POST /api/bridge/requestDepositAction
 *        { externalChainId, externalTxHash: <leg-1 hash>, action: 2,
 *          targetToken: GOLDST }
 *
 * The bridge service (mercata/services/bridge) polls Sepolia, sees the
 * DepositRouted event, mints USDST to the recipient on STRATO and (because
 * action=2 AUTO_FORGE was queued) auto-forges USDST → GOLDST server-side.
 * The load test does NOT call /api/metal-forge/buy directly — AUTO_FORGE
 * handles the metal mint.
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

  async run(clients: NodeClients): Promise<ScenarioResult> {
    const cfg = this.config.scenarios.tokenSale;
    const node = this.config.nodes[0];

    // Required-field validation.
    if (!cfg.bridge) {
      throw new Error(
        "tokenSale: `bridge` config is required — supply sepoliaRpcUrl, " +
          "sepoliaPrivateKey, depositRouterAddress, sepoliaTokenAddress, " +
          "stratoRecipientAddress, targetStratoToken.",
      );
    }
    const b = cfg.bridge;
    if (!b.sepoliaRpcUrl) throw new Error("tokenSale.bridge: sepoliaRpcUrl is required");
    if (!b.sepoliaPrivateKey) throw new Error("tokenSale.bridge: sepoliaPrivateKey is required");
    if (!b.depositRouterAddress) throw new Error("tokenSale.bridge: depositRouterAddress is required");
    if (!b.stratoRecipientAddress) throw new Error("tokenSale.bridge: stratoRecipientAddress is required");
    if (!b.targetStratoToken) throw new Error("tokenSale.bridge: targetStratoToken is required");
    if (!b.sepoliaTokenAddress) {
      throw new Error(
        "tokenSale.bridge: sepoliaTokenAddress is required (e.g. Sepolia " +
          "USDC at 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238).",
      );
    }
    if (!cfg.metalTokenAddress) {
      throw new Error(
        "tokenSale: metalTokenAddress is required — the GOLDST (or other " +
          "metal) target of the AUTO_FORGE post-deposit action.",
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

    const baseBridgeBody = {
      externalChainId: cfg.externalChainId ?? "11155111",
      externalTxHash: "" as string, // overridden per iteration with the broadcast hash
      action: 2 as const, // AUTO_FORGE
      targetToken: cfg.metalTokenAddress,
    };

    // ---- Bring up Sepolia broadcaster (lazy-imports ethers) ----
    const broadcaster = new SepoliaBroadcaster({
      rpcUrl: b.sepoliaRpcUrl,
      privateKey: b.sepoliaPrivateKey,
      depositRouterAddress: b.depositRouterAddress,
      tokenAddress: b.sepoliaTokenAddress,
      permit2Address: b.permit2Address,
      chainId: b.chainId,
      gasLimit: b.gasLimit,
      maxFeePerGasGwei: b.maxFeePerGasGwei,
      maxPriorityFeePerGasGwei: b.maxPriorityFeePerGasGwei,
      startNonce: b.startNonce,
    });
    await broadcaster.init();
    const broadcasterRecipient = normalizeAddress0x(b.stratoRecipientAddress);
    const broadcasterTarget = normalizeAddress0x(b.targetStratoToken);
    const broadcasterAmount = b.amountPerTx ?? "1000"; // 0.001 USDC (USDC has 6 decimals)
    console.log(
      `[tokenSale] Sepolia broadcaster ready — wallet=${broadcaster.walletAddress} ` +
        `startNonce=${broadcaster.startNonce} amount=${broadcasterAmount} ` +
        `token=${b.sepoliaTokenAddress} -> strato=${broadcasterRecipient} ` +
        `stratoToken=${broadcasterTarget} awaitConfirmation=${b.awaitConfirmation === true}`,
    );

    // ---- EOA balance sanity check (fail-fast diagnostic) ----
    // If the broadcaster EOA lacks USDC or Sepolia ETH, every deposit will
    // revert with "ERC20: insufficient balance" / "out of gas" — surface
    // that up-front so the user doesn't wait 5 minutes for a TIMEOUT.
    try {
      const eoaBal = await broadcaster.getEoaBalances();
      const requiredToken = BigInt(broadcasterAmount) * BigInt(cfg.totalTxCount);
      const tokenStr = eoaBal.tokenUnits === null ? "?" : eoaBal.tokenUnits.toString();
      console.log(
        `[tokenSale] EOA ${broadcaster.walletAddress} balances: ` +
          `ETH=${eoaBal.ethWei} wei, ` +
          `${b.sepoliaTokenAddress.substring(0, 10)}…=${tokenStr} ` +
          `(need ≥${requiredToken} for ${cfg.totalTxCount} bridge(s) of ${broadcasterAmount} each)`,
      );
      if (eoaBal.tokenUnits !== null && eoaBal.tokenUnits < requiredToken) {
        console.warn(
          `[tokenSale] WARN: EOA token balance ${eoaBal.tokenUnits} < required ` +
            `${requiredToken}. Deposits will revert on Permit2 transferFrom — ` +
            `top up the EOA at https://faucet.circle.com (Sepolia USDC).`,
        );
      }
      if (eoaBal.ethWei < BigInt("100000000000000")) {
        // < 0.0001 ETH likely insufficient for even one tx
        console.warn(
          `[tokenSale] WARN: EOA ETH balance ${eoaBal.ethWei} wei is low — ` +
            `deposits may run out of gas. Top up at https://www.alchemy.com/faucets/ethereum-sepolia.`,
        );
      }
    } catch (err: any) {
      console.warn(`[tokenSale] EOA balance check failed: ${err.message}`);
    }

    // Balance-snapshot configuration. Snapshots are useful for verifying the
    // bridge service actually drained the deposits and AUTO_FORGE landed
    // metal on the recipient. Note that the bridge service is asynchronous —
    // the post-run snapshot taken immediately after the broadcast/bridge-
    // request loop may understate the eventual deltas.
    const logBalances: BalanceLoggingMode = cfg.logBalances ?? "none";
    const snapshotTargets: SnapshotTargets = {
      payTokenAddress: cfg.payTokenAddress ?? "937efa7e3a77e20bbdbd7c0d32b6514f368c1010",
      metalTokenAddress: cfg.metalTokenAddress,
      metalForgeAddress: cfg.metalForgeAddress ?? "c5ed981b816a626981a5747d125e0e7296b2c7c6",
    };
    const snapshotsEnabled = logBalances !== "none";

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

    // ---- Pre-loop RECIPIENT balances (for end-to-end AUTO_FORGE verification).
    // The bridge service mints USDST + AUTO_FORGE GOLDST to
    // `bridge.stratoRecipientAddress`, which may differ from the Keycloak
    // user driving the test — so we read it directly from Cirrus rather than
    // through the auth-filtered /api/tokens/balance endpoint. ----
    const recipientHex = b.stratoRecipientAddress.replace(/^0x/i, "").toLowerCase();
    const payTokenHex = (cfg.payTokenAddress ?? "937efa7e3a77e20bbdbd7c0d32b6514f368c1010")
      .replace(/^0x/i, "")
      .toLowerCase();
    const metalTokenHex = cfg.metalTokenAddress.replace(/^0x/i, "").toLowerCase();
    const autoForgeWaitTimeoutSec = cfg.autoForgeWaitTimeoutSec ?? 300;
    const autoForgeWaitPollSec = cfg.autoForgeWaitPollIntervalSec ?? 5;
    let preLoopRecipientUsdst: bigint | null = null;
    let preLoopRecipientGoldst: bigint | null = null;
    if (autoForgeWaitTimeoutSec > 0 && this.backendClients[0]) {
      preLoopRecipientUsdst = await readCirrusBalance(
        this.backendClients[0],
        payTokenHex,
        recipientHex,
      );
      preLoopRecipientGoldst = await readCirrusBalance(
        this.backendClients[0],
        metalTokenHex,
        recipientHex,
      );
      console.log(
        `[tokenSale] pre-loop [recipient ${recipientHex}]: ` +
          `USDST=${preLoopRecipientUsdst ?? "?"} GOLDST=${preLoopRecipientGoldst ?? "?"}`,
      );
    }

    console.log(
      `[tokenSale] ${cfg.totalTxCount} sales (sepoliaDeposit + bridgeRequest) ` +
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

        // --- Sepolia broadcast leg ---
        // Each iteration broadcasts a fresh DepositRouter.deposit(USDC, ...)
        // with nonce = startNonce + i. The resulting tx hash is fed into the
        // bridge-request body so every iteration represents a UNIQUE on-chain
        // bridge entry.
        const submitTime = Date.now();
        const result = await broadcaster.broadcastDepositERC20({
          nonceOffset: i,
          stratoRecipient: broadcasterRecipient,
          targetStratoToken: broadcasterTarget,
          amountWei: broadcasterAmount,
          awaitConfirmation: b.awaitConfirmation === true,
          permitDeadlineSec: b.permitDeadlineSec,
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

        // If the broadcast itself failed there's nothing meaningful to
        // bridge — the bridge service won't find a DepositRouted event.
        if (result.status === "failed") return;

        // --- Bridge request leg (AUTO_FORGE) ---
        const bridgeBody = { ...baseBridgeBody, externalTxHash: result.txHash };
        const bridgeSubmitTime = Date.now();
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
          submitTime: bridgeSubmitTime,
          res,
          success: bridgeOk,
          hashOverride: hash,
        });
      },
    );
    const runEnd = Date.now();

    // ---- Sepolia receipt sweep ----
    // With awaitConfirmation: false the iteration loop records `submitted`
    // the moment the tx hash returns from the JSON-RPC; we have no idea
    // whether the tx confirmed or reverted. Before waiting for AUTO_FORGE,
    // poll receipts for every successful broadcast so we can distinguish:
    //   - "confirmed + DepositRouted ≥ 1": Sepolia side OK, blame bridge service
    //   - "reverted": on-chain failure (Permit2 / token allowance / decimals)
    //   - "pending": still unmined, AUTO_FORGE wait will likely time out
    //   - "not_found": tx never made it into the mempool
    const broadcastMetrics = txMetrics.filter(
      (m) =>
        m.scenario === `${scenario}:sepoliaDeposit` && m.status !== "failed",
    );
    let sweepSummary = {
      confirmed: 0,
      reverted: 0,
      pending: 0,
      notFound: 0,
      depositRoutedTotal: 0,
    };
    if (broadcastMetrics.length > 0) {
      console.log(
        `[tokenSale] Sweeping ${broadcastMetrics.length} Sepolia receipt(s) ` +
          `(timeout=60s/tx)...`,
      );
      for (const m of broadcastMetrics) {
        const r = await broadcaster.inspectReceipt(m.txHash, {
          timeoutMs: 60000,
          pollMs: 3000,
        });
        if (r.status === "confirmed") sweepSummary.confirmed += 1;
        else if (r.status === "reverted") sweepSummary.reverted += 1;
        else if (r.status === "pending") sweepSummary.pending += 1;
        else sweepSummary.notFound += 1;
        sweepSummary.depositRoutedTotal += r.depositRoutedCount;

        // Promote the per-tx metric status now that we know what actually
        // happened on-chain. Without this, every Sepolia broadcast under
        // `awaitConfirmation: false` would stay tagged "submitted", which
        // computeScenarioStats does not count as success — producing the
        // misleading "0/N succeeded" rows in the summary table. The metric
        // object is shared by reference with MetricsCollector, so mutating
        // it here propagates to the JSON/HTML report and the summary.
        if (r.status === "confirmed") {
          m.status = "confirmed";
          // confirmDuration stays = 0 (we never awaited the receipt during
          // the iteration loop) and totalDuration = submitDuration. The
          // submit-side latency is the meaningful number for a throughput-
          // oriented load test; confirm-side timing would require fetching
          // the block timestamp per tx which we don't bother with.
          m.totalDuration = m.submitDuration + (m.confirmDuration ?? 0);
        } else if (r.status === "reverted") {
          m.status = "failed";
          m.error = r.errorReason
            ? `Sepolia revert: ${r.errorReason}`
            : "Sepolia receipt status=0";
        } else if (r.status === "not_found") {
          m.status = "failed";
          m.error = "Sepolia tx not found on-chain after sweep timeout";
        }
        // r.status === "pending": tx still in mempool at end of sweep —
        // leave as "submitted". The AUTO_FORGE wait will then almost
        // certainly TIMEOUT, surfacing the issue separately.

        const blockStr = r.blockNumber !== undefined ? ` block=${r.blockNumber}` : "";
        const gasStr = r.gasUsed !== undefined ? ` gasUsed=${r.gasUsed}` : "";
        const reasonStr = r.errorReason ? ` reason="${r.errorReason}"` : "";
        const tag =
          r.status === "confirmed" && r.depositRoutedCount >= 1
            ? "OK"
            : r.status === "confirmed"
              ? "CONFIRMED_NO_EVENT"
              : r.status.toUpperCase();
        console.log(
          `[tokenSale] receipt ${m.txHash.substring(0, 18)}… [${tag}]${blockStr}${gasStr}` +
            ` DepositRouted×${r.depositRoutedCount}${reasonStr}`,
        );
      }
      console.log(
        `[tokenSale] Sepolia sweep summary: ` +
          `${sweepSummary.confirmed} confirmed, ` +
          `${sweepSummary.reverted} reverted, ` +
          `${sweepSummary.pending} pending, ` +
          `${sweepSummary.notFound} not_found, ` +
          `${sweepSummary.depositRoutedTotal} DepositRouted event(s) total.`,
      );
      if (sweepSummary.reverted > 0) {
        console.warn(
          `[tokenSale] ${sweepSummary.reverted} Sepolia tx(s) reverted. ` +
            `These will NEVER be processed by the bridge service — ` +
            `the bridge polls for DepositRouted events which only emit on success. ` +
            `See receipt log for revert reasons.`,
        );
      }
      if (
        sweepSummary.confirmed > 0 &&
        sweepSummary.depositRoutedTotal === 0
      ) {
        console.warn(
          `[tokenSale] ${sweepSummary.confirmed} Sepolia tx(s) confirmed but ` +
            `zero DepositRouted events emitted. The DepositRouter at ` +
            `${b.depositRouterAddress} may be a different contract than expected, ` +
            `or its event signature has changed.`,
        );
      }
    }

    // ---- AUTO_FORGE end-to-end verification ----
    // The broadcast + bridgeRequest legs are now done, but the bridge
    // service still has to (a) wait for Sepolia confirmations,
    // (b) MercataBridge.completeDeposit -> mint USDST, (c) MetalForge.mintMetal
    // -> mint GOLDST. Poll the recipient's STRATO GOLDST balance via Cirrus
    // until we've seen `expectedMints` distinct increments OR the balance
    // settles (>= 2 stable polls after at least one mint) OR the timeout
    // elapses.
    let autoForgeReport: {
      expected: number;
      observed: number;
      goldstDelta: bigint;
      usdstDelta: bigint;
      timedOut: boolean;
      durationSec: number;
    } | null = null;
    const successfulBroadcasts = txMetrics.filter(
      (m) => m.scenario === `${scenario}:sepoliaDeposit` && m.status !== "failed",
    ).length;
    if (
      autoForgeWaitTimeoutSec > 0 &&
      successfulBroadcasts > 0 &&
      this.backendClients[0]
    ) {
      const expectedMints = successfulBroadcasts;
      console.log(
        `[tokenSale] Polling recipient ${recipientHex} for AUTO_FORGE completion ` +
          `(expecting ${expectedMints} mint(s), timeout=${autoForgeWaitTimeoutSec}s, ` +
          `poll=${autoForgeWaitPollSec}s)...`,
      );
      const waitStart = Date.now();
      const timeoutMs = autoForgeWaitTimeoutSec * 1000;
      const pollMs = autoForgeWaitPollSec * 1000;
      const baseGoldst = preLoopRecipientGoldst ?? 0n;
      const baseUsdst = preLoopRecipientUsdst ?? 0n;
      let lastGoldst: bigint | null = baseGoldst;
      let mintsObserved = 0;
      let stableCount = 0;
      let pollIdx = 0;
      let timedOut = true;
      while (Date.now() - waitStart < timeoutMs) {
        // Sleep first so we give the bridge service room to make progress
        // before the first read (broadcasts may not even have been mined yet
        // if awaitConfirmation: false).
        await new Promise((r) => setTimeout(r, pollMs));
        pollIdx += 1;
        const elapsedSec = Math.round((Date.now() - waitStart) / 1000);
        const curGoldst = await readCirrusBalance(
          this.backendClients[0],
          metalTokenHex,
          recipientHex,
        );
        const curUsdst = await readCirrusBalance(
          this.backendClients[0],
          payTokenHex,
          recipientHex,
        );
        const dGoldst = (curGoldst ?? 0n) - baseGoldst;
        const dUsdst = (curUsdst ?? 0n) - baseUsdst;
        const changed =
          curGoldst !== null && lastGoldst !== null && curGoldst !== lastGoldst;
        if (changed) {
          mintsObserved += 1;
          stableCount = 0;
        } else {
          stableCount += 1;
        }
        console.log(
          `[tokenSale] autoForgeWait #${pollIdx} t=${elapsedSec}s ` +
            `recipient.USDST=${curUsdst ?? "?"} (Δ${dUsdst >= 0n ? "+" : ""}${dUsdst}) ` +
            `recipient.GOLDST=${curGoldst ?? "?"} (Δ${dGoldst >= 0n ? "+" : ""}${dGoldst}) ` +
            `mints=${mintsObserved}/${expectedMints}` +
            (stableCount > 0 ? ` [stable ×${stableCount}]` : ""),
        );
        if (curGoldst !== null) lastGoldst = curGoldst;

        // Done: either we counted all expected mints, OR balance has been
        // stable for >=2 polls after at least one mint (assume the bridge
        // service has drained its queue for these deposits).
        if (mintsObserved >= expectedMints) {
          timedOut = false;
          console.log(
            `[tokenSale] AUTO_FORGE complete: ${mintsObserved}/${expectedMints} mints ` +
              `landed in ${elapsedSec}s. recipient.GOLDST Δ=+${dGoldst}, recipient.USDST Δ=${dUsdst >= 0n ? "+" : ""}${dUsdst}.`,
          );
          autoForgeReport = {
            expected: expectedMints,
            observed: mintsObserved,
            goldstDelta: dGoldst,
            usdstDelta: dUsdst,
            timedOut: false,
            durationSec: elapsedSec,
          };
          break;
        }
        if (mintsObserved > 0 && stableCount >= 2) {
          timedOut = false;
          // Multiple Sepolia broadcasts whose corresponding AUTO_FORGE mints
          // land in the same STRATO block (or arrive at Cirrus within one
          // poll window) produce a SINGLE balance row update — so
          // `mintsObserved` undercounts when the bridge service drains its
          // queue in a burst. Settling with a non-zero delta is a stronger
          // correctness signal than the bump count: it means the bridge
          // pipeline drained and stopped emitting changes for this row.
          // Report both numbers but treat settling as [OK]. (`mintsObserved`
          // remains the per-mint accuracy signal at low concurrency.)
          console.log(
            `[tokenSale] AUTO_FORGE settled in ${elapsedSec}s: ` +
              `${mintsObserved} distinct GOLDST balance update(s) observed for ` +
              `${expectedMints} broadcast(s). Updates may coalesce when mints ` +
              `land in the same STRATO block — corroborate via the GOLDST Δ ` +
              `(should be ~${expectedMints}× per-mint amount). recipient.GOLDST Δ=+${dGoldst}.`,
          );
          autoForgeReport = {
            expected: expectedMints,
            observed: mintsObserved,
            goldstDelta: dGoldst,
            usdstDelta: dUsdst,
            timedOut: false,
            durationSec: elapsedSec,
          };
          break;
        }
      }
      if (timedOut) {
        const elapsedSec = Math.round((Date.now() - waitStart) / 1000);
        const finalGoldst = await readCirrusBalance(
          this.backendClients[0],
          metalTokenHex,
          recipientHex,
        );
        const finalUsdst = await readCirrusBalance(
          this.backendClients[0],
          payTokenHex,
          recipientHex,
        );
        const dGoldst = (finalGoldst ?? 0n) - baseGoldst;
        const dUsdst = (finalUsdst ?? 0n) - baseUsdst;
        if (mintsObserved > 0) {
          console.warn(
            `[tokenSale] AUTO_FORGE PARTIAL after ${elapsedSec}s: ` +
              `${mintsObserved} balance update(s) observed for ${expectedMints} broadcast(s); ` +
              `recipient.GOLDST Δ=${dGoldst >= 0n ? "+" : ""}${dGoldst}. ` +
              `Pipeline still moving at deadline — bridge service may still be draining; ` +
              `re-check Cirrus after a few minutes.`,
          );
        } else {
          console.warn(
            `[tokenSale] AUTO_FORGE TIMEOUT after ${elapsedSec}s: ` +
              `0 balance updates for ${expectedMints} broadcast(s); ` +
              `recipient.GOLDST Δ=+0. ` +
              `Bridge service appears idle — check sepolia receipts (above), ` +
              `bridge-service health, and MercataBridge router registration.`,
          );
        }
        autoForgeReport = {
          expected: expectedMints,
          observed: mintsObserved,
          goldstDelta: dGoldst,
          usdstDelta: dUsdst,
          timedOut: true,
          durationSec: elapsedSec,
        };
      }
    } else if (autoForgeWaitTimeoutSec === 0) {
      console.log(
        `[tokenSale] AUTO_FORGE wait disabled (autoForgeWaitTimeoutSec=0). ` +
          `End-to-end mint verification skipped — re-check recipient balance manually.`,
      );
    } else if (successfulBroadcasts === 0) {
      console.warn(
        `[tokenSale] No successful Sepolia broadcasts — skipping AUTO_FORGE wait.`,
      );
    }

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

    // Aggregate sale-level stats. A "sale" is one sepoliaDeposit +
    // one bridgeRequest. Count successes across both legs.
    const elapsedSec = (runEnd - runStart) / 1000;
    const callsPerSale = 2;
    const coreMetrics = txMetrics.filter(
      (m) =>
        m.scenario === `${scenario}:sepoliaDeposit` ||
        m.scenario === `${scenario}:bridgeRequest`,
    );
    const confirmed = coreMetrics.filter(
      (m) => m.status === "confirmed" || m.status === "submitted",
    ).length;
    const failed = coreMetrics.filter((m) => m.status === "failed").length;
    const salesAttempted = Math.floor(coreMetrics.length / callsPerSale);
    const salesTps = salesAttempted / Math.max(elapsedSec, 0.001);
    const callTps = coreMetrics.length / Math.max(elapsedSec, 0.001);

    console.log(
      `[tokenSale] Done. calls: ${confirmed} confirmed, ${failed} failed in ` +
        `${elapsedSec.toFixed(2)}s — ${salesTps.toFixed(2)} sales/s (${callTps.toFixed(2)} calls/s)`,
    );
    if (autoForgeReport) {
      // Tag semantics:
      //   OK       — pipeline drained: either every expected mint produced its
      //              own observable balance update, OR the balance moved and
      //              then settled (mints may have coalesced into fewer Cirrus
      //              updates than broadcasts, but the recipient received
      //              GOLDST and the bridge service stopped acting on this row).
      //   PARTIAL  — deadline reached while balance was still moving, OR
      //              deadline reached after some movement but before settling.
      //   TIMEOUT  — deadline reached with zero observed balance change.
      let tag: "OK" | "PARTIAL" | "TIMEOUT";
      if (!autoForgeReport.timedOut) {
        tag = "OK";
      } else if (autoForgeReport.observed > 0) {
        tag = "PARTIAL";
      } else {
        tag = "TIMEOUT";
      }
      console.log(
        `[tokenSale] AUTO_FORGE [${tag}]: ${autoForgeReport.observed} balance update(s) ` +
          `observed for ${autoForgeReport.expected} broadcast(s) on recipient in ` +
          `${autoForgeReport.durationSec}s ` +
          `(GOLDST Δ=+${autoForgeReport.goldstDelta}, USDST Δ=${autoForgeReport.usdstDelta >= 0n ? "+" : ""}${autoForgeReport.usdstDelta})`,
      );
    }

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
   * Phase 1: broadcast all N Sepolia DepositRouter.deposit txs in parallel
   *          (bounded by `sepoliaConcurrency`). Captures successful tx hashes.
   * Phase 2: for each successful broadcast, fire the AUTO_FORGE bridge
   *          request, with up to `backendConcurrency` such calls in parallel.
   *
   * Wall clock = max(slowest single broadcast) + max(slowest single backend
   * round-trip) instead of N × per-iteration latency.
   */
  private async runPipelined(args: {
    cfg: TokenSaleScenarioConfig;
    broadcaster: SepoliaBroadcaster;
    broadcasterRecipient: string;
    broadcasterTarget: string;
    broadcasterAmount: string;
    baseBridgeBody: any;
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
      sepoliaConcurrency,
      backendConcurrency,
      nodeName,
      scenario,
      txMetrics,
      shouldLogProgress,
    } = args;
    const b = cfg.bridge;

    // ---- Phase 1: broadcast all N concurrently ----
    const successfulBroadcasts = new Map<number, string>();
    console.log(
      `[tokenSale] Phase 1/2: broadcasting ${cfg.totalTxCount} Sepolia ` +
        `deposit(s) (concurrency=${sepoliaConcurrency}, awaitConfirmation=${b.awaitConfirmation === true})...`,
    );
    const phase1Start = Date.now();
    await runBoundedConcurrent(cfg.totalTxCount, sepoliaConcurrency, async (i: number) => {
      const submitTime = Date.now();
      const result = await broadcaster.broadcastDepositERC20({
        nonceOffset: i,
        stratoRecipient: broadcasterRecipient,
        targetStratoToken: broadcasterTarget,
        amountWei: broadcasterAmount,
        awaitConfirmation: b.awaitConfirmation === true,
        permitDeadlineSec: b.permitDeadlineSec,
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

    // ---- Phase 2: bridgeRequest concurrently ----
    const phase2Indices = Array.from(successfulBroadcasts.keys()).sort((a, b) => a - b);
    if (phase2Indices.length === 0) {
      console.log(`[tokenSale] Phase 2/2: skipped (no successful broadcasts).`);
      return;
    }

    console.log(
      `[tokenSale] Phase 2/2: ${phase2Indices.length} bridgeRequest call(s) ` +
        `(concurrency=${backendConcurrency})...`,
    );
    const phase2Start = Date.now();
    await runBoundedConcurrent(phase2Indices.length, backendConcurrency, async (idx) => {
      const i = phase2Indices[idx];
      const client = this.backendClients[i % this.backendClients.length];
      const externalTxHash = successfulBroadcasts.get(i)!;

      const bridgeBody = { ...baseBridgeBody, externalTxHash };
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
    });
    const phase2Ms = Date.now() - phase2Start;
    console.log(
      `[tokenSale] Phase 2 done in ${(phase2Ms / 1000).toFixed(2)}s`,
    );
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
