import { config } from "../config";
import {
  getEnabledChains,
} from "../services/cirrusService";
import { depositBatch } from "../services/bridgeService";
import { blockTrackingService } from "../services/blockTrackingService";
import { NonEmptyArray, DepositArgs, ChainInfo } from "../types";
import {
  getCurrentBlockNumber,
  getChainLogs,
  isChainConfigured,
} from "../services/rpcService";
import { logError } from "../utils/logger";
import { normalizeAddress } from "../utils/utils";

// DepositInitiated(uint256,string,address,uint256,address) keccak256 hash
import { DEPOSIT_EVENT_SIGNATURE } from "../config";

const parseDepositEvents = async (logs: any[], externalChainId: number): Promise<DepositArgs[]> => {
  return logs.map((log) => {
    const externalToken = normalizeAddress(log.topics[1]);
    const externalSender = normalizeAddress(log.topics[2]);
    const stratoRecipient = normalizeAddress(log.topics[3]);
    // Event: DepositRouted(address indexed token, uint256 amount, address indexed sender, address indexed stratoAddress, uint96 depositId)
    // Data layout: [amount(32 bytes)][depositId(32 bytes)]
    const externalTokenAmount = BigInt("0x" + log.data.substring(2, 66)).toString();

    return {
      externalChainId,
      externalSender,
      externalToken,
      externalTokenAmount,
      externalTxHash: log.transactionHash,
      stratoRecipient
    };
  });
};

const pollChainForDeposits = async (chainInfo: ChainInfo) => {
  const externalChainId = chainInfo.externalChainId;
  const depositRouter = chainInfo.depositRouter;
  const blockchainLastProcessedBlock = parseInt(chainInfo.lastProcessedBlock) || 0;
  
  // Get the effective last processed block (max of blockchain and local storage)
  const lastProcessedBlock = await blockTrackingService.getEffectiveLastProcessedBlock(
    externalChainId, 
    blockchainLastProcessedBlock
  );
  
  let currentBlock: number | null = null;
  let depositsProcessed = false;

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
      // No deposits found - only update locally
      await blockTrackingService.updateLastProcessedBlockLocally(externalChainId, currentBlock);
      return;
    }

    const validDeposits = await parseDepositEvents(logs, externalChainId);

    const filteredDeposits = validDeposits.filter(
      (deposit) => deposit !== null,
    );
    const failedParses = validDeposits.length - filteredDeposits.length;

    // Process valid deposits first
    if (filteredDeposits.length > 0) {
      await depositBatch(filteredDeposits as NonEmptyArray<DepositArgs>);
      depositsProcessed = true;
    }

    // If there were parse failures, throw error after processing valid ones
    if (failedParses > 0) {
      throw new Error(`Failed to parse ${failedParses} out of ${validDeposits.length} deposits for chain ${externalChainId}`);
    }
  } finally {
    // Update lastProcessedBlock based on whether deposits were processed
    if (currentBlock !== null && currentBlock > lastProcessedBlock) {
      try {
        if (depositsProcessed) {
          // Deposits were processed - update both local and blockchain
          await blockTrackingService.updateLastProcessedBlockEverywhere(externalChainId, currentBlock);
        }
        // Note: Local-only update for no deposits case is already handled above in the "no logs" section
      } catch (updateError) {
        // Enhance error with context before re-throwing
        const enhancedError = new Error(`Block update failed for chain ${externalChainId} block ${currentBlock}: ${(updateError as Error).message}\nOriginal stack: ${(updateError as Error).stack}`);
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
