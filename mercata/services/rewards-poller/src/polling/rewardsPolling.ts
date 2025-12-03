import { config } from "../config";
import { logInfo, logError } from "../utils/logger";
import {
  getEventsBatch,
  getEventQueryParams,
} from "../services/cirrusService";
import {
  batchHandleAction,
} from "../services/rewardsService";
import { checkBalances } from "../utils/balanceCheck";
import { RewardsAction, NonEmptyArray } from "../types";
import { blockTrackingService } from "../services/blockTrackingService";

const processEvents = async (): Promise<void> => {
  try {
    logInfo("RewardsPolling", "Starting polling cycle");
    await checkBalances();

    const { contractAddresses, eventNames, minBlockNumber, validPairs } = await getEventQueryParams();
    
    if (contractAddresses.length === 0 || eventNames.length === 0) {
      throw new Error("No event mappings found");
    }

    const allEvents = await getEventsBatch(
      contractAddresses,
      eventNames,
      minBlockNumber,
      validPairs
    );

    const allActions: RewardsAction[] = allEvents.map((event) => ({
      sourceContract: event.address,
      eventName: event.event_name,
      user: event.transaction_sender,
      amount: event.amount,
      blockNumber: event.block_number,
      eventIndex: event.event_index,
    }));

    if (allActions.length === 0) {
      return;
    }

    const maxBatchSize = config.polling.maxBatchSize;
    for (let i = 0; i < allActions.length; i += maxBatchSize) {
      const batch = allActions.slice(i, i + maxBatchSize) as NonEmptyArray<RewardsAction>;
      const maxBlockInBatch = Math.max(...batch.map(a => a.blockNumber));
      
      try {
        await batchHandleAction(batch);
        await blockTrackingService.updateLastProcessedBlock(maxBlockInBatch);
      } catch (error) {
        const errorMessage = (error as Error).message;
        const isContractFailure =
          errorMessage.includes("Error running the transaction") ||
          errorMessage.includes("solidity") ||
          errorMessage.includes("Transaction failed") ||
          errorMessage.includes("require failed");

        if (isContractFailure) {
          logError("RewardsPolling", error as Error, {
            operation: "processEvents",
            message: "Contract failure - updating block number to avoid retry loop",
            batchSize: batch.length,
            maxBlock: maxBlockInBatch,
          });
          await blockTrackingService.updateLastProcessedBlock(maxBlockInBatch);
        } else {
          throw error;
        }
      }
    }

    logInfo("RewardsPolling", `Processed ${allActions.length} actions`);
  } catch (error) {
    logError("RewardsPolling", error as Error, {
      operation: "processEvents",
    });
  }
};

export const startRewardsPolling = (): void => {
  const pollingInterval = config.polling.interval;

  const poll = async () => {
    await processEvents();
    setTimeout(poll, pollingInterval);
  };

  void poll();

  logInfo("RewardsPolling", `Started rewards polling with interval ${pollingInterval}ms`);
};

export const initializeRewardsPolling = async () => {
  logInfo("RewardsPolling", "Initializing rewards polling...");

  startRewardsPolling();

  logInfo("RewardsPolling", "Rewards polling initialized");
};

