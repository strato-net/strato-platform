import { config, DEPOSIT_EVENT_SIGNATURES, WAD } from "../config";
import {
  getEnabledChains,
  getBridgeInfo,
  getRebaseFactors,
} from "../services/cirrusService";
import {
  depositBatch,
  depositBatchWithAction,
} from "../services/bridgeService";
import { blockTrackingService } from "../services/blockTrackingService";
import {
  ActionDepositArgs,
  ChainInfo,
  DepositArgs,
  NonEmptyArray,
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
  if (classified.actionDeposits.length > 0) {
    await depositBatchWithAction(
      classified.actionDeposits as NonEmptyArray<ActionDepositArgs>,
    );
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
