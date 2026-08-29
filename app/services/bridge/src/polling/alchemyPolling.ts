import {
  config,
  DEPOSIT_EVENT_SIGNATURES,
  getDepositReconciliationDepth,
  getChainWsRpcUrl,
  getMissingReceiptGraceMs,
  getReviewRecordRetryMs,
  getSettlementRetryGraceMs,
  WAD,
} from "../config";
import { WebSocketProvider } from "ethers";
import {
  getEnabledChains,
  getAssetInfo,
  getBridgeInfo,
  getExternalBridgeRebaseFactors,
  getRebaseRequiredRoutes,
  getRouteRebaseKey,
} from "../services/cirrusService";
import {
  recordDepositForReview,
  settleDeposit,
  settleRoutedDeposit,
} from "../services/bridgeService";
import { blockTrackingService } from "../services/blockTrackingService";
import {
  ActionDepositArgs,
  ChainInfo,
  DepositArgs,
  NonEmptyArray,
  RouteDepositArgs,
} from "../types";
import {
  getCurrentBlockNumber,
  getBlockTimestamp,
  getChainLogs,
  isChainConfigured,
} from "../services/rpcService";
import { logError, logInfo } from "../utils/logger";
import {
  classifyDepositLogs,
  RawDepositLog,
} from "../services/depositEventService";
import {
  quarantineDeposit,
  quarantineDepositLog,
} from "../services/depositQuarantineService";
import {
  clampCursorToPending,
  depositStateService,
  shouldRecordReview,
} from "../services/depositStateService";
import {
  depositIdentity,
  verifyDetectedDepositsBatch,
} from "../services/verificationService";
import { depositMetricsService } from "../services/depositMetricsService";
import { fetchRouteSteps } from "../services/routeQuoteService";
import { convertToStratoDecimals } from "../utils/utils";

const AUTO_ROUTE_ACTION = "4";
const normalizeAddress = (value: string): string =>
  value.toLowerCase().replace(/^0x/, "");

const realtimeProviders = new Map<
  number,
  { provider: WebSocketProvider; routerKey: string }
>();

export const getRoutedDepositAmount = async (
  deposit: DepositArgs | ActionDepositArgs,
  externalDecimals: number,
  loadRequiredRoutes = getRebaseRequiredRoutes,
  loadFactors = getExternalBridgeRebaseFactors,
): Promise<bigint> => {
  const amount = convertToStratoDecimals(
    deposit.externalTokenAmount,
    externalDecimals,
  );
  const requiredRoutes = await loadRequiredRoutes();
  const routeKey = getRouteRebaseKey(
    deposit.externalToken,
    deposit.externalChainId,
    deposit.targetStratoToken,
  );
  if (!requiredRoutes.has(routeKey)) return amount;

  const factors = await loadFactors([deposit.targetStratoToken]);
  const stratoKey = deposit.targetStratoToken.toLowerCase().replace(/^0x/, "");
  const factor = factors.get(stratoKey);
  if (!factor || factor <= 0n) {
    throw new Error(`Rebase factor unavailable for required route ${routeKey}`);
  }
  return (amount * WAD) / factor;
};

export const attemptDepositSettlement = async <T extends DepositArgs>(
  deposit: T,
  submit: (deposit: T) => Promise<string | null> = settleDeposit,
): Promise<Error | null> => {
  try {
    await submit(deposit);
    return null;
  } catch (error) {
    return error as Error;
  }
};

const recordReviewOnce = async (
  deposit: DepositArgs | ActionDepositArgs,
  operation: string,
): Promise<void> => {
  await depositStateService.markReviewAttempted(deposit);
  try {
    await recordDepositForReview(deposit);
    await depositStateService.markReviewRecorded(deposit);
  } catch (error) {
    logError("AlchemyPolling", error as Error, {
      operation,
      depositIdentity: depositIdentity(deposit),
    });
  }
};

const pollChainForDepositsUnlocked = async (chainInfo: ChainInfo) => {
  const externalChainId = chainInfo.externalChainId;
  const depositRouters = chainInfo.depositRouters?.length
    ? chainInfo.depositRouters
    : [chainInfo.depositRouter];
  const reviewRetryMs = getReviewRecordRetryMs();
  const reviewedDeposits =
    await depositStateService.listReviews(externalChainId);
  for (const reviewed of reviewedDeposits) {
    if (!shouldRecordReview(reviewed, reviewRetryMs)) continue;
    await recordReviewOnce(reviewed.deposit, "retryDepositReviewRecord");
  }
  const blockchainLastProcessedBlock = chainInfo.lastProcessedBlock;
  // Get the effective last processed block (max of blockchain and local storage)
  const lastProcessedBlock = await blockTrackingService.getEffectiveLastProcessedBlock(
    externalChainId, 
    blockchainLastProcessedBlock
  );
  const oldestPendingAtStart =
    await depositStateService.oldestPendingBlock(externalChainId);
  const scanCursor = clampCursorToPending(
    lastProcessedBlock,
    oldestPendingAtStart,
  );
  
  if (!isChainConfigured(externalChainId)) return;

  const currentBlock = await getCurrentBlockNumber(externalChainId);
  const logs =
    currentBlock > scanCursor
      ? ((await getChainLogs(
          externalChainId,
          Math.max(
            0,
            scanCursor - getDepositReconciliationDepth() + 1,
          ),
          currentBlock,
          depositRouters,
          DEPOSIT_EVENT_SIGNATURES,
        )) as RawDepositLog[])
      : [];

  const classified = classifyDepositLogs(logs, externalChainId);
  for (const quarantined of classified.quarantinedLogs) {
    await quarantineDepositLog(
      externalChainId,
      quarantined.log,
      quarantined.error,
    );
  }

  const detectedDeposits = [
    ...classified.standardDeposits,
    ...classified.actionDeposits,
  ];
  const blockNumbers = [
    ...new Set(detectedDeposits.map((deposit) => deposit.externalBlockNumber)),
  ];
  const blockTimestamps = new Map(
    await Promise.all(
      blockNumbers.map(async (blockNumber) => {
        try {
          return [
            blockNumber,
            await getBlockTimestamp(externalChainId, blockNumber),
          ] as const;
        } catch (error) {
          logInfo(
            "AlchemyPolling",
            `Block timestamp unavailable for chain ${externalChainId} block ${blockNumber}; using detection time`,
          );
          return [blockNumber, undefined] as const;
        }
      }),
    ),
  );
  for (const deposit of detectedDeposits) {
    deposit.externalBlockTimestamp =
      blockTimestamps.get(deposit.externalBlockNumber) || deposit.detectedAt;
    const pending = await depositStateService.upsert(deposit);
    if (pending.deposit.detectedAt === deposit.detectedAt) {
      depositMetricsService.observe(
        "detection",
        deposit.detectedAt - deposit.externalBlockTimestamp,
      );
    }
    if (shouldRecordReview(pending, reviewRetryMs)) {
      await recordReviewOnce(pending.deposit, "recordDetectedDepositForReview");
      logError("AlchemyPolling", new Error(pending.reviewReason), {
        depositIdentity: depositIdentity(deposit),
      });
    }
  }

  const pending = await depositStateService.list(externalChainId);
  const pendingDeposits = pending.map(({ deposit }) => deposit);
  const routedDeposits = pendingDeposits.filter(
    (deposit) =>
      (deposit as Partial<ActionDepositArgs>).action === AUTO_ROUTE_ACTION,
  );
  const routeAssets =
    routedDeposits.length > 0
      ? await getAssetInfo(
          [...new Set(routedDeposits.map(({ externalToken }) => externalToken))] as NonEmptyArray<string>,
          externalChainId,
        )
      : new Map();
  const custodyAddress = chainInfo.vault || chainInfo.custody;
  if (!custodyAddress) {
    throw new Error(`Custody address not configured for chain ${externalChainId}`);
  }
  const verificationStartedAt = Date.now();
  const verificationResults = await verifyDetectedDepositsBatch(
    pendingDeposits,
    currentBlock,
    custodyAddress,
  );
  if (pendingDeposits.length > 0) {
    depositMetricsService.observe(
      "verification",
      Date.now() - verificationStartedAt,
    );
  }
  for (const deposit of pendingDeposits) {
    const verification = verificationResults.get(depositIdentity(deposit));
    logInfo(
      "AlchemyPolling",
      `Deposit verification exit ${depositIdentity(deposit)} state=${verification?.state || "unknown"}`,
      {
        blockNumber: deposit.externalBlockNumber,
        externalTxHash: deposit.externalTxHash,
      },
    );
    if (!verification || verification.state === "confirming") continue;
    if (
      verification.state === "missing" ||
      verification.state === "relocated"
    ) {
      const updated = await depositStateService.markReceiptMissing(
        deposit,
        getMissingReceiptGraceMs(),
      );
      if (updated && shouldRecordReview(updated, reviewRetryMs)) {
        await recordReviewOnce(deposit, "recordMissingDepositForReview");
        logError("AlchemyPolling", new Error(updated.reviewReason), {
          depositIdentity: depositIdentity(deposit),
        });
      }
      continue;
    }
    if (verification.state === "invalid") {
      await depositStateService.markForReview(
        deposit,
        verification.error.message,
      );
      await recordReviewOnce(deposit, "recordInvalidDepositForReview");
      logError("AlchemyPolling", verification.error, {
        depositIdentity: depositIdentity(deposit),
      });
      continue;
    }
    const submissionStartedAt = Date.now();
    let settlementError: Error | null;
    const actionDeposit = deposit as Partial<ActionDepositArgs>;
    depositMetricsService.recordOperatorSettlementChoice(
      actionDeposit.action === AUTO_ROUTE_ACTION,
    );
    logInfo(
      "AlchemyPolling",
      `Deposit settlement authority trace ${depositIdentity(deposit)}`,
      {
        settlementAuthority: "bridgeOperator",
        stratoRecipient: deposit.stratoRecipient,
        stratoToken: deposit.targetStratoToken,
        externalTokenAmount: deposit.externalTokenAmount,
        action: actionDeposit.action || "0",
        actionToken: actionDeposit.actionToken,
        minFinalOut: actionDeposit.minFinalOut,
      },
    );
    if (actionDeposit.action === AUTO_ROUTE_ACTION) {
      const asset = [...routeAssets.values()].find(
        (candidate) =>
          normalizeAddress(candidate.externalToken) ===
            normalizeAddress(deposit.externalToken) &&
          normalizeAddress(candidate.stratoToken) ===
            normalizeAddress(deposit.targetStratoToken),
      );
      try {
        if (!asset) {
          throw new Error("Bridge route metadata is unavailable");
        }
        const amountIn = await getRoutedDepositAmount(
          deposit,
          asset.externalDecimals,
        );
        const steps = await fetchRouteSteps({
          tokenIn: deposit.targetStratoToken,
          tokenOut: actionDeposit.actionToken!,
          amountIn: amountIn.toString(),
          minFinalOut: actionDeposit.minFinalOut!,
        });
        settlementError = await attemptDepositSettlement(
          { ...deposit, ...actionDeposit, steps } as RouteDepositArgs,
          settleRoutedDeposit,
        );
      } catch (error) {
        logInfo(
          "AlchemyPolling",
          `AUTO_ROUTE quote unavailable for ${depositIdentity(deposit)}; using source-token fallback: ${(error as Error).message}`,
        );
        settlementError = await attemptDepositSettlement(deposit);
      }
    } else {
      settlementError = await attemptDepositSettlement(deposit);
    }
    if (settlementError) {
      logError("AlchemyPolling", settlementError, {
        operation: "settleDeposit",
        depositIdentity: depositIdentity(deposit),
      });
      const failed = await depositStateService.markSettlementFailed(
        deposit,
        settlementError,
        getSettlementRetryGraceMs(),
      );
      if (failed?.transitioned) {
        await quarantineDeposit(deposit, failed.pending.reviewReason!);
        await recordReviewOnce(deposit, "recordFailedSettlementForReview");
      }
      continue;
    }
    depositMetricsService.observe(
      "stratoSubmission",
      Date.now() - submissionStartedAt,
    );
    depositMetricsService.observe(
      "completion",
      Date.now() - deposit.externalBlockTimestamp,
    );
    await depositStateService.markSettled(deposit);
    logInfo(
      "AlchemyPolling",
      `Deposit settlement exit ${depositIdentity(deposit)} state=settled`,
    );
  }

  const oldestPendingBlock =
    await depositStateService.oldestPendingBlock(externalChainId);
  const cursorTarget = clampCursorToPending(
    currentBlock,
    oldestPendingBlock,
  );
  if (cursorTarget > lastProcessedBlock) {
    await blockTrackingService.updateLastProcessedBlockEverywhere(
      externalChainId,
      cursorTarget,
    );
  }
  await depositStateService.pruneSettled(
    externalChainId,
    Math.max(0, cursorTarget - getDepositReconciliationDepth()),
  );
};

const pollingChains = new Set<number>();
const trailingPolls = new Set<number>();

const pollChainForDeposits = async (chainInfo: ChainInfo): Promise<void> => {
  const chainId = chainInfo.externalChainId;
  if (pollingChains.has(chainId)) {
    trailingPolls.add(chainId);
    return;
  }
  pollingChains.add(chainId);
  try {
    do {
      trailingPolls.delete(chainId);
      await pollChainForDepositsUnlocked(chainInfo);
    } while (trailingPolls.has(chainId));
  } finally {
    pollingChains.delete(chainId);
    trailingPolls.delete(chainId);
  }
};

const syncRealtimeSubscription = (chainInfo: ChainInfo): void => {
  const wsUrl = getChainWsRpcUrl(chainInfo.externalChainId);
  if (!wsUrl) return;
  const routers = chainInfo.depositRouters?.length
    ? chainInfo.depositRouters
    : [chainInfo.depositRouter];
  const routerKey = routers.map((router) => router.toLowerCase()).sort().join(",");
  const existing = realtimeProviders.get(chainInfo.externalChainId);
  if (existing?.routerKey === routerKey) return;
  if (existing) {
    realtimeProviders.delete(chainInfo.externalChainId);
    void existing.provider.destroy().catch(() => undefined);
  }

  const provider = new WebSocketProvider(wsUrl);
  realtimeProviders.set(chainInfo.externalChainId, { provider, routerKey });
  let disconnected = false;
  const handleDisconnect = () => {
    if (disconnected) return;
    disconnected = true;
    const active = realtimeProviders.get(chainInfo.externalChainId);
    if (active?.provider === provider) {
      realtimeProviders.delete(chainInfo.externalChainId);
    }
    void provider.destroy().catch(() => undefined);
    logError(
      "AlchemySubscription",
      new Error(`Deposit WebSocket disconnected on chain ${chainInfo.externalChainId}`),
    );
    setTimeout(() => syncRealtimeSubscription(chainInfo), 1_000);
  };
  const socket = provider.websocket as any;
  if (typeof socket.on === "function") {
    socket.on("close", handleDisconnect);
    socket.on("error", handleDisconnect);
  } else if (typeof socket.addEventListener === "function") {
    socket.addEventListener("close", handleDisconnect);
    socket.addEventListener("error", handleDisconnect);
  }
  void provider
    .on(
      {
        address: routers,
        topics: [DEPOSIT_EVENT_SIGNATURES],
      },
      () => {
        void pollChainForDeposits(chainInfo).catch((error) =>
          logError("AlchemySubscription", error as Error, {
            externalChainId: chainInfo.externalChainId,
          }),
        );
      },
    )
    .catch(handleDisconnect);
  logInfo(
    "AlchemySubscription",
    `Subscribed to ${routers.length} deposit router(s) on chain ${chainInfo.externalChainId}`,
  );
};

export const reconcileExternalDeposits = async (
  externalChainId: number,
): Promise<void> => {
  const chain = (await getEnabledChains()).get(externalChainId);
  if (!chain) throw new Error(`External chain ${externalChainId} is not enabled`);
  await pollChainForDeposits(chain);
};

export const startMultiChainDepositPolling = () => {
  const interval = config.polling.bridgeInInterval || 100_000;
  const poll = async () => {
    try {
      const [chains, info] = await Promise.all([getEnabledChains(), getBridgeInfo()]);
      if (!chains.size) return logInfo("AlchemyPolling", "No enabled chains");
      if (info?.withdrawalsPaused) logInfo("AlchemyPolling", "Withdrawals are paused");
      if (info?.depositsPaused) return logInfo("AlchemyPolling", "Deposits are paused");
      const infos = Array.from(chains.values());
      infos.forEach(syncRealtimeSubscription);
      (await Promise.allSettled(infos.map(pollChainForDeposits)))
        .forEach((result, i) => result.status === "rejected" &&
          logError("AlchemyPolling", result.reason, {
            operation: "pollChainForDeposits",
            chain: infos[i],
          }));
    } catch (e) {
      logError("AlchemyPolling", e as Error, { operation: "startMultiChainDepositPolling" });
    }
  };
  poll();
  setInterval(poll, interval);
};
