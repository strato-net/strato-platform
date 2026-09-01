import { config, DEPOSIT_EVENT_SIGNATURES, WAD } from "../config";
import {
  getEnabledChains,
  getAssetInfo,
  getBridgeInfo,
  getRebaseFactors,
} from "../services/cirrusService";
import {
  depositBatch,
  depositBatchWithAction,
  depositWithRoutes,
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
  getChainLogs,
  isChainConfigured,
} from "../services/rpcService";
import { logError, logInfo } from "../utils/logger";
import {
  classifyDepositLogs,
  RawDepositLog,
} from "../services/depositEventService";
import { fetchRouteSteps } from "../services/routeQuoteService";
import { convertToStratoDecimals } from "../utils/utils";

const AUTO_ROUTE_ACTION = "4";

const applyRebaseFactors = async (
  deposits: Array<DepositArgs | ActionDepositArgs>,
) => {
  if (deposits.length === 0) return;
  const targetTokens = [...new Set(deposits.map((d) => d.targetStratoToken))];
  const factors = await getRebaseFactors(targetTokens);
  for (const deposit of deposits) {
    const stratoKey = deposit.targetStratoToken.toLowerCase().replace(/^0x/, "");
    const factor = factors.get(stratoKey);
    if (!factor) continue;
    const original = BigInt(deposit.externalTokenAmount);
    const adjusted = (original * WAD) / factor;
    logInfo(
      "AlchemyPolling",
      `Rebasing deposit ${deposit.externalTxHash}: ${original} → ${adjusted} (factor=${factor})`,
    );
    deposit.externalTokenAmount = adjusted.toString();
  }
};

const pollChainForDeposits = async (chainInfo: ChainInfo) => {
  const externalChainId = chainInfo.externalChainId;
  const depositRouter = chainInfo.depositRouter;
  const blockchainLastProcessedBlock = chainInfo.lastProcessedBlock;
  // Get the effective last processed block (max of blockchain and local storage)
  const lastProcessedBlock = await blockTrackingService.getEffectiveLastProcessedBlock(
    externalChainId, 
    blockchainLastProcessedBlock
  );
  
  if (!isChainConfigured(externalChainId)) return;

  const currentBlock = await getCurrentBlockNumber(externalChainId);
  if (currentBlock <= lastProcessedBlock) return;

  const logs = (await getChainLogs(
    externalChainId,
    lastProcessedBlock + 1,
    currentBlock,
    depositRouter,
    DEPOSIT_EVENT_SIGNATURES,
  )) as RawDepositLog[];

  if (logs.length === 0) {
    await blockTrackingService.updateLastProcessedBlockLocally(
      externalChainId,
      currentBlock,
    );
    return;
  }

  const classified = classifyDepositLogs(logs, externalChainId);
  await applyRebaseFactors([
    ...classified.standardDeposits,
    ...classified.actionDeposits,
  ]);
  if (classified.standardDeposits.length > 0) {
    await depositBatch(
      classified.standardDeposits as NonEmptyArray<DepositArgs>,
    );
  }
  const legacyActionDeposits = classified.actionDeposits.filter(
    (deposit) => deposit.action !== AUTO_ROUTE_ACTION,
  );
  const routeActionDeposits = classified.actionDeposits.filter(
    (deposit) => deposit.action === AUTO_ROUTE_ACTION,
  );
  if (legacyActionDeposits.length > 0) {
    await depositBatchWithAction(
      legacyActionDeposits as NonEmptyArray<ActionDepositArgs>,
    );
  }
  if (routeActionDeposits.length > 0) {
    const externalTokens = [
      ...new Set(routeActionDeposits.map((deposit) => deposit.externalToken)),
    ] as NonEmptyArray<string>;
    const assets = await getAssetInfo(externalTokens, externalChainId);
    const routed: RouteDepositArgs[] = [];
    const fallbacks: ActionDepositArgs[] = [];

    for (const deposit of routeActionDeposits) {
      const key = `${deposit.externalToken}:${externalChainId}`;
      const keyWithoutPrefix = `${deposit.externalToken.replace(/^0x/i, "")}:${externalChainId}`;
      const asset = assets.get(key) || assets.get(keyWithoutPrefix);
      try {
        if (!asset) throw new Error("Bridge asset metadata is unavailable");
        const amountIn = convertToStratoDecimals(
          deposit.externalTokenAmount,
          asset.externalDecimals,
        ).toString();
        const steps = await fetchRouteSteps({
          tokenIn: deposit.targetStratoToken,
          tokenOut: deposit.actionToken,
          amountIn,
          minFinalOut: deposit.minFinalOut,
        });
        routed.push({ ...deposit, steps });
      } catch (error) {
        logInfo(
          "AlchemyPolling",
          `AUTO_ROUTE quote unavailable for ${deposit.externalTxHash}; recording source-token fallback: ${(error as Error).message}`,
        );
        fallbacks.push(deposit);
      }
    }

    if (routed.length > 0) {
      await depositWithRoutes(routed as NonEmptyArray<RouteDepositArgs>);
    }
    if (fallbacks.length > 0) {
      await depositBatchWithAction(
        fallbacks as NonEmptyArray<ActionDepositArgs>,
      );
    }
  }
  await blockTrackingService.updateLastProcessedBlockEverywhere(
    externalChainId,
    currentBlock,
  );
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
