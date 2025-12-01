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
    await checkBalances();

    const { contractAddresses, eventNames, minBlockNumber } = await getEventQueryParams();
    
    if (contractAddresses.length === 0 || eventNames.length === 0) {
      throw new Error("No event mappings found");
    }

    const allEvents = await getEventsBatch(
      contractAddresses,
      eventNames,
      minBlockNumber,
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
      await batchHandleAction(batch);
      
      const maxBlockInBatch = Math.max(...batch.map(a => a.blockNumber));
      try {
        await blockTrackingService.updateLastProcessedBlock(maxBlockInBatch);
      } catch (error) {
        logError("RewardsPolling", error as Error, {
          operation: "updateLastProcessedBlock",
          blockNumber: maxBlockInBatch,
        });
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
  };

  void poll();
  setInterval(poll, pollingInterval);

  logInfo("RewardsPolling", `Started rewards polling with interval ${pollingInterval}ms`);
};

export const initializeRewardsPolling = async () => {
  logInfo("RewardsPolling", "Initializing rewards polling...");

  startRewardsPolling();

  logInfo("RewardsPolling", "Rewards polling initialized");
};

