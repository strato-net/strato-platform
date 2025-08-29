import { config } from "../config";
import {
  getEnabledChains,
  getEnabledAssets,
} from "../services/cirrusService";
import { depositBatch, updateLastProcessedBlock } from "../services/bridgeService";
import { NonEmptyArray, Deposit, ChainInfo } from "../types";
import {
  getCurrentBlockNumber,
  getChainLogs,
  isChainConfigured,
} from "../services/rpcService";
import { logError } from "../utils/logger";
import {
  convertToStratoDecimals,
  normalizeAddress,
  ensureHexPrefix,
} from "../utils/utils";
import { STRATO_DECIMALS } from "../config";

// DepositInitiated(uint256,string,address,uint256,address) keccak256 hash
import { DEPOSIT_EVENT_SIGNATURE } from "../config";

const getStratoTokenMapping = async (
  externalChainId: number,
): Promise<Map<string, { stratoToken: string; externalDecimals: number }>> => {
  const enabledAssets = await getEnabledAssets();
  
  return new Map(
    enabledAssets
      .filter(asset => 
        asset.externalChainId === externalChainId.toString() && 
        asset.externalToken
      )
      .map(asset => [
        ensureHexPrefix(asset.externalToken).toLowerCase(),
        {
          stratoToken: asset.stratoToken,
          externalDecimals: parseInt(asset.externalDecimals) || STRATO_DECIMALS,
        }
      ])
  );
};

const parseDepositEvents = async (logs: any[], externalChainId: number) => {
  const tokenMapping = await getStratoTokenMapping(externalChainId);
  return logs.map((log) => {
    const externalToken = normalizeAddress(log.topics[1]);
    const externalSender = normalizeAddress(log.topics[2]);
    const stratoRecipient = normalizeAddress(log.topics[3]);
    const externalTokenAmount = "0x" + log.data.substring(2, 66);
    const mint = log.data.substring(130, 132) === "01";

    const tokenInfo = tokenMapping.get(externalToken);
    if (!tokenInfo) {
      return null;
    }

    // Convert amount from external decimals to STRATO decimals
    const stratoTokenAmount = convertToStratoDecimals(
      externalTokenAmount,
      tokenInfo.externalDecimals,
    );

    return {
      externalChainId,
      externalTxHash: log.transactionHash,
      externalSender,
      stratoRecipient,
      stratoToken: tokenInfo.stratoToken,
      stratoTokenAmount,
      mintUSDST: mint,
    };
  });
};

const pollChainForDeposits = async (chainInfo: ChainInfo) => {
  const externalChainId = chainInfo.externalChainId;
  const depositRouter = chainInfo.depositRouter;
  const lastProcessedBlock = parseInt(chainInfo.lastProcessedBlock) || 0;
  let currentBlock: number | null = null;

  try {
    if (!isChainConfigured(externalChainId)) return;

    currentBlock = await getCurrentBlockNumber(externalChainId);
    if (currentBlock <= lastProcessedBlock) {
      return;
    }

    const logs = await getChainLogs(
      externalChainId,
      lastProcessedBlock + 1,
      currentBlock,
      depositRouter,
      DEPOSIT_EVENT_SIGNATURE,
    );

    if (logs.length === 0) {
      return;
    }

    const validDeposits = await parseDepositEvents(logs, externalChainId);

    const filteredDeposits = validDeposits.filter(
      (deposit) => deposit !== null,
    );
    const failedParses = validDeposits.length - filteredDeposits.length;

    // Process valid deposits first
    if (filteredDeposits.length > 0) {
      await depositBatch(filteredDeposits as NonEmptyArray<Deposit>);
    }

    // If there were parse failures, throw error after processing valid ones
    if (failedParses > 0) {
      throw new Error(`Failed to parse ${failedParses} out of ${validDeposits.length} deposits for chain ${externalChainId}`);
    }
  } finally {
    // Always update lastProcessedBlock if we got a currentBlock
    if (currentBlock !== null && currentBlock > lastProcessedBlock) {
      try {
        await updateLastProcessedBlock(externalChainId, currentBlock);
      } catch (updateError) {
        // Enhance error with context before re-throwing
        const enhancedError = new Error(`updateLastProcessedBlock failed for chain ${externalChainId} block ${currentBlock}: ${(updateError as Error).message}\nOriginal stack: ${(updateError as Error).stack}`);
        throw enhancedError;
      }
    }
  }
};

export const startMultiChainDepositPolling = () => {
  const pollingInterval = config.polling.bridgeInInterval || 100 * 1000;

  const poll = async () => {
    try {
      const enabledChains = await getEnabledChains();
      if (enabledChains.length === 0) return;

      const results = await Promise.allSettled(enabledChains.map(pollChainForDeposits));
      
      // Log any errors from individual chain processing
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          logError("AlchemyPolling", result.reason, {
            operation: "pollChainForDeposits",
            chain: enabledChains[index],
          });
        }
      });
    } catch (e: any) {
      logError("AlchemyPolling", e as Error, {
        operation: "startMultiChainDepositPolling",
      });
    }
  };

  poll();
  setInterval(poll, pollingInterval);
};
