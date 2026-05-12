import { NodeClients } from "../api/client";
import { runRateLimited } from "../concurrency";
import {
  ScenarioResult,
  TxMetric,
  TokenSaleScenarioConfig,
  BalanceLoggingMode,
} from "../types";
import {
  takeUserBalanceSnapshot,
  takeForgeBalanceSnapshot,
  sumUserSnapshots,
  readCirrusBalance,
  formatSnapshot,
  formatDiff,
  SnapshotTargets,
  BalanceSnapshot,
} from "../api/balanceSnapshot";
import { SepoliaBroadcaster, normalizeAddress0x } from "../tx/sepoliaBroadcast";
import { AppScenario } from "./appScenario";

/**
 * Scenario 1 — Token Sale TPS (canonical Mercata Bridge-In flow).
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
 * The load test does NOT call /api/metal-forge/buy directly — for that
 * flow see the `forgeBuy` scenario.
 *
 * Post-loop diagnostics:
 *   - Sepolia receipt sweep: per broadcast hash, fetch receipt + decode
 *     status / DepositRouted event count / revert reason. Promotes
 *     "submitted" metric statuses to "confirmed" / "failed" so the report
 *     is accurate.
 *   - AUTO_FORGE wait: poll the recipient's GOLDST balance via Cirrus until
 *     either expected mints land OR balance settles after some movement
 *     OR the timeout elapses. Tagged [OK] / [PARTIAL] / [TIMEOUT].
 */
export class TokenSaleScenario extends AppScenario {
  private static readonly LABEL = "tokenSale";
  private static readonly PAGE_LOAD_STEPS_TEMPLATE: ReadonlyArray<{
    name: string;
    pathFor: (externalChainId: string) => string;
  }> = [
    { name: "networkConfigs", pathFor: () => "/api/bridge/networkConfigs" },
    { name: "depositActions", pathFor: () => "/api/bridge/depositActions" },
    {
      name: "bridgeableTokens",
      pathFor: (cid) => `/api/bridge/bridgeableTokens/${cid}`,
    },
    { name: "metalForgeConfigs", pathFor: () => "/api/metal-forge/configs" },
  ];

  name(): string {
    return TokenSaleScenario.LABEL;
  }

  async run(clients: NodeClients): Promise<ScenarioResult> {
    const cfg = this.config.scenarios.tokenSale;
    const node = this.config.nodes[0];

    // ---- Required-field validation ----
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

    await this.initClientPool(
      cfg,
      { backendUrl: node.url, auth: node.auth },
      TokenSaleScenario.LABEL,
    );

    const nodeName = clients.nodeName;
    const scenario = this.name();
    const txMetrics: TxMetric[] = [];

    // ---- Optional page-load warmup per user ----
    if (cfg.includePageLoad) {
      const externalChainId = cfg.externalChainId ?? "11155111";
      await this.runPageWarmup({
        steps: TokenSaleScenario.PAGE_LOAD_STEPS_TEMPLATE.map((s) => ({
          name: s.name,
          path: s.pathFor(externalChainId),
        })),
        scenarioLabel: TokenSaleScenario.LABEL,
        txMetrics,
        nodeName,
      });
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
    const broadcasterAmount = b.amountPerTx ?? "1000"; // 0.001 USDC (6 decimals)
    console.log(
      `[tokenSale] Sepolia broadcaster ready — wallet=${broadcaster.walletAddress} ` +
        `startNonce=${broadcaster.startNonce} amount=${broadcasterAmount} ` +
        `token=${b.sepoliaTokenAddress} -> strato=${broadcasterRecipient} ` +
        `stratoToken=${broadcasterTarget} awaitConfirmation=${b.awaitConfirmation === true}`,
    );

    // ---- EOA balance sanity check (fail-fast diagnostic) ----
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
        console.warn(
          `[tokenSale] WARN: EOA ETH balance ${eoaBal.ethWei} wei is low — ` +
            `deposits may run out of gas. Top up at https://www.alchemy.com/faucets/ethereum-sepolia.`,
        );
      }
    } catch (err: any) {
      console.warn(`[tokenSale] EOA balance check failed: ${err.message}`);
    }

    // ---- Balance-snapshot configuration ----
    const logBalances: BalanceLoggingMode = cfg.logBalances ?? "none";
    const snapshotTargets: SnapshotTargets = {
      payTokenAddress: cfg.payTokenAddress ?? "937efa7e3a77e20bbdbd7c0d32b6514f368c1010",
      metalTokenAddress: cfg.metalTokenAddress,
      metalForgeAddress: cfg.metalForgeAddress ?? "c5ed981b816a626981a5747d125e0e7296b2c7c6",
    };
    const snapshotsEnabled = logBalances !== "none";

    const progressStep = Math.max(1, Math.ceil(cfg.totalTxCount / 20));
    const shouldLogProgress = (i: number) =>
      this.verbose || i % progressStep === 0 || i === cfg.totalTxCount - 1;

    // ---- Pre-run snapshots (per unique Keycloak user + one shared forge
    // snapshot). Auth-filtered routes return only the calling user's
    // balances, so per-user accuracy requires N user snapshots; the forge
    // state (MetalForge holdings, totalMinted) is global so we read it
    // once. NOTE: in tokenSale the bridge service mints to
    // `bridge.stratoRecipientAddress` regardless of which Keycloak user
    // posted the bridgeRequest — these per-user buyer.* snapshots are
    // auth-filtered to the caller, NOT the recipient. The end-to-end
    // mint check on the recipient uses the dedicated AUTO_FORGE wait
    // poll below (which reads Cirrus directly by recipient address). ----
    const uniqueUsers = this.getUniqueUsers();
    const preUserSnaps: Map<string, BalanceSnapshot> = new Map();
    let preForgeSnap: BalanceSnapshot | null = null;
    if (snapshotsEnabled && uniqueUsers.length > 0) {
      try {
        const [forgeSnap, ...userSnaps] = await Promise.all([
          takeForgeBalanceSnapshot(uniqueUsers[0].client, snapshotTargets),
          ...uniqueUsers.map(({ client }) =>
            takeUserBalanceSnapshot(client, snapshotTargets),
          ),
        ]);
        preForgeSnap = forgeSnap;
        for (let i = 0; i < uniqueUsers.length; i++) {
          preUserSnaps.set(uniqueUsers[i].username, userSnaps[i]);
          console.log(
            `[tokenSale] ${formatSnapshot(`pre-run [${uniqueUsers[i].username}]`, userSnaps[i])}`,
          );
        }
        console.log(`[tokenSale] ${formatSnapshot("pre-run [forge/global]", preForgeSnap)}`);
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

    // ---- Per-iteration loop: each worker does broadcast → bridgeRequest. ----
    const runStart = Date.now();
    await runRateLimited(
      cfg.totalTxCount,
      cfg.timeWindowMs,
      cfg.concurrentUsers,
      async (i: number) => {
        const client = this.backendClients[i % this.backendClients.length];

        // --- Sepolia broadcast leg ---
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

        // If the broadcast itself failed there's nothing meaningful to bridge —
        // the bridge service won't find a DepositRouted event.
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
          scenarioLabel: TokenSaleScenario.LABEL,
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
        // r.status === "pending": leave as "submitted".

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
          // correctness signal than the bump count.
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

    // ---- Post-run snapshots (per-user + shared forge), per-user deltas,
    // and a pool-wide aggregate of buyer.* fields. ----
    if (snapshotsEnabled && uniqueUsers.length > 0) {
      try {
        const [postForgeSnap, ...postUserSnapsArr] = await Promise.all([
          takeForgeBalanceSnapshot(uniqueUsers[0].client, snapshotTargets),
          ...uniqueUsers.map(({ client }) =>
            takeUserBalanceSnapshot(client, snapshotTargets),
          ),
        ]);
        const preUserList: BalanceSnapshot[] = [];
        const postUserList: BalanceSnapshot[] = [];
        for (let i = 0; i < uniqueUsers.length; i++) {
          const username = uniqueUsers[i].username;
          const post = postUserSnapsArr[i];
          const pre = preUserSnaps.get(username);
          console.log(
            `[tokenSale] ${formatSnapshot(`post-run [${username}]`, post)}`,
          );
          if (pre) {
            console.log(`[tokenSale] ${username} ${formatDiff(pre, post)}`);
            preUserList.push(pre);
            postUserList.push(post);
          }
        }
        console.log(
          `[tokenSale] ${formatSnapshot("post-run [forge/global]", postForgeSnap)}`,
        );
        if (preForgeSnap) {
          console.log(`[tokenSale] forge ${formatDiff(preForgeSnap, postForgeSnap)}`);
        }
        if (uniqueUsers.length > 1 && preUserList.length === postUserList.length) {
          const preAgg: BalanceSnapshot = {
            ts: 0,
            ...sumUserSnapshots(preUserList),
            errors: [],
          };
          const postAgg: BalanceSnapshot = {
            ts: 0,
            ...sumUserSnapshots(postUserList),
            errors: [],
          };
          console.log(
            `[tokenSale] pool-aggregate (${uniqueUsers.length} users) ${formatDiff(preAgg, postAgg)}`,
          );
        }
      } catch (err: any) {
        console.warn(`[tokenSale] post-run snapshot failed: ${err.message}`);
      }
    }

    // ---- Aggregate sale-level stats ----
    // A "sale" is one sepoliaDeposit + one bridgeRequest (callsPerSale = 2).
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
      //   OK       — pipeline drained: every expected mint produced its own
      //              balance update OR the balance moved and then settled.
      //   PARTIAL  — deadline reached while balance was still moving.
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
}
