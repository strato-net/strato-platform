import { config } from "../../infra/config/runtimeConfig";
import { logInfo, logError } from "../../infra/observability/logger";
import {
  getEventsBatch,
  getEventQueryParams,
} from "../events-read/cirrusEvents.client";
import { batchHandleAction } from "../rewards-cycle/rewardsBatch.writer";
import { checkBalances } from "../rewards-cycle/rewardsBalance.guard";
import { RewardsAction, NonEmptyArray } from "../../shared/types";
import { blockTrackingService } from "../../infra/state/blockTracking.repo";
import { nextCursorAfter } from "../events-read/eventRecord.mapper";
import { isContractExecutionFailure } from "../../shared/core/errors";

export const processRewardsCycle = async (): Promise<void> => {
  try {
    logInfo("RewardsPolling", "Starting polling cycle");
    await checkBalances();

    const { contractAddresses, eventNames, cursor, validPairs } = await getEventQueryParams();

    if (contractAddresses.length === 0 || eventNames.length === 0) {
      throw new Error("No event mappings found");
    }

    const allEvents = await getEventsBatch(
      contractAddresses,
      eventNames,
      cursor,
      validPairs
    );

    const allActions: RewardsAction[] = allEvents.map((event) => ({
      sourceContract: event.address,
      eventName: event.event_name,
      user: event.transaction_sender,
      amount: event.amount,
      blockNumber: event.block_number,
      block_timestamp: event.block_timestamp,
      eventIndex: event.event_index,
    }));

    if (allActions.length === 0) {
      return;
    }

    const maxBatchSize = config.polling.maxBatchSize;
    for (let i = 0; i < allActions.length; i += maxBatchSize) {
      const batch = allActions.slice(i, i + maxBatchSize) as NonEmptyArray<RewardsAction>;
      const last = batch[batch.length - 1];

      try {
        await batchHandleAction(batch);
        await blockTrackingService.updateCursor(nextCursorAfter(last));
      } catch (error) {
        if (isContractExecutionFailure(error)) {
          logError("RewardsPolling", error as Error, {
            operation: "processEvents",
            message: "Contract failure - skipping batch",
            batchSize: batch.length,
            lastBlock: last.blockNumber,
            lastEventIndex: last.eventIndex,
          });
          await blockTrackingService.updateCursor(nextCursorAfter(last));
          continue;
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
