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

// Public RPCs (HyperEVM included) cap eth_getLogs ranges — scan in windows below that cap
const DEFAULT_LOGS_SPAN = 800;
const MAX_WINDOWS_PER_TICK = 30;

const getLogsSpan = (chainId: number): number =>
  Number(process.env[`CHAIN_${chainId}_LOGS_SPAN`]) || DEFAULT_LOGS_SPAN;

// Split [fromBlock, toBlock] into at most `cap` windows of `span` blocks
export const planLogWindows = (
  fromBlock: number,
  toBlock: number,
  span: number,
  cap: number,
): Array<[number, number]> => {
  const windows: Array<[number, number]> = [];
  let from = fromBlock;
  for (let i = 0; i < cap && from <= toBlock; i++) {
    const to = Math.min(from + span - 1, toBlock);
    windows.push([from, to]);
    from = to + 1;
  }
  return windows;
};

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

const recordDeposits = async (
  logs: RawDepositLog[],
  externalChainId: number,
) => {
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

  // Advance the watermark per drained window: a throw mid catch-up never re-widens the range
  const windows = planLogWindows(
    lastProcessedBlock + 1,
    currentBlock,
    getLogsSpan(externalChainId),
    MAX_WINDOWS_PER_TICK,
  );

  for (const [fromBlock, toBlock] of windows) {
    const logs = (await getChainLogs(
      externalChainId,
      fromBlock,
      toBlock,
      depositRouter,
      DEPOSIT_EVENT_SIGNATURES,
    )) as RawDepositLog[];

    if (logs.length === 0) {
      await blockTrackingService.updateLastProcessedBlockLocally(
        externalChainId,
        toBlock,
      );
      continue;
    }

    await recordDeposits(logs, externalChainId);
    await blockTrackingService.updateLastProcessedBlockEverywhere(
      externalChainId,
      toBlock,
    );
  }
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
