import {
  config,
  DEPOSIT_EVENT_SIGNATURES,
  getChainConfirmations,
  WAD,
} from "../config";
import {
  getEnabledChains,
  getBridgeInfo,
  getRebaseFactors,
} from "../services/cirrusService";
import { blockTrackingService } from "../services/blockTrackingService";
import { depositRecorder } from "../services/depositRecorder";
import { ChainInfo, WindowDeposit } from "../types";
import {
  getCurrentBlockNumber,
  getChainLogs,
  hasBlock,
  isChainConfigured,
} from "../services/rpcService";
import { logError, logInfo } from "../utils/logger";
import { startNonOverlappingPolling } from "../utils/polling";
import {
  extractWindowDeposits,
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

const applyRebaseFactors = async (deposits: WindowDeposit[]) => {
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
      `Rebasing deposit ${deposit.depositKey}: ${original} → ${adjusted} (factor=${factor})`,
    );
    deposit.externalTokenAmount = adjusted.toString();
  }
};

export const pollChainForDeposits = async (chainInfo: ChainInfo) => {
  const externalChainId = chainInfo.externalChainId;
  const depositRouter = chainInfo.depositRouter;
  if (!isChainConfigured(externalChainId)) return;

  // Get the effective last processed block (max of blockchain and local storage)
  const lastProcessedBlock = await blockTrackingService.getEffectiveLastProcessedBlock(
    externalChainId,
    chainInfo.lastProcessedBlock,
  );

  // Only scan blocks buried under enough confirmations that a reorg cannot rewrite them
  const scanHead =
    (await getCurrentBlockNumber(externalChainId)) - getChainConfirmations(externalChainId);
  if (scanHead <= lastProcessedBlock) return;

  // Advance the watermark per drained window: a throw mid catch-up never re-widens the range
  const windows = planLogWindows(
    lastProcessedBlock + 1,
    scanHead,
    getLogsSpan(externalChainId),
    MAX_WINDOWS_PER_TICK,
  );

  for (const [fromBlock, toBlock] of windows) {
    // A load-balanced RPC can answer eth_getLogs from a node that has not reached toBlock yet,
    // which returns a silently short result; never pass a block the endpoint cannot serve
    if (!(await hasBlock(externalChainId, toBlock))) {
      throw new Error(
        `RPC for chain ${externalChainId} cannot serve block ${toBlock} yet; not advancing past ${fromBlock - 1}`,
      );
    }

    const logs = (await getChainLogs(
      externalChainId,
      fromBlock,
      toBlock,
      depositRouter,
      DEPOSIT_EVENT_SIGNATURES,
    )) as RawDepositLog[];

    const deposits = extractWindowDeposits(logs, externalChainId);
    await applyRebaseFactors(deposits);
    await depositRecorder.recordWindow(externalChainId, toBlock, deposits);
  }
};

export const startMultiChainDepositPolling = () => {
  const interval = config.polling.bridgeInInterval || 100_000;
  const poll = async () => {
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
  };
  startNonOverlappingPolling(
    "AlchemyPolling",
    "startMultiChainDepositPolling",
    interval,
    poll,
  );
};
