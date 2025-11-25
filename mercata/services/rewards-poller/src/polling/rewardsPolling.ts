import { config } from "../config";
import { logInfo, logError } from "../utils/logger";
import {
  getEventsBatch,
  getRewardsActivities,
} from "../services/cirrusService";
import {
  depositBatch,
  withdrawBatch,
  occurredBatch,
} from "../services/rewardsService";
import { blockTrackingService } from "../services/blockTrackingService";
import { checkBalances } from "../utils/balanceCheck";
import { ProtocolEvent, RewardsAction, EventMapping, NonEmptyArray, ActivityInfo } from "../types";

let eventMappings: EventMapping[] = [];
let activitiesCache: Map<string, ActivityInfo> = new Map();

const parseEventName = (activityName: string): string | null => {
  const parts = activityName.split("-");
  if (parts.length < 2) {
    return null;
  }
  return parts[parts.length - 1];
};

const buildEventMappings = (activities: Map<string, ActivityInfo>): EventMapping[] => {
  const mappings: EventMapping[] = [];

  for (const [activityName, activity] of activities.entries()) {
    const eventName = parseEventName(activityName);
    if (!eventName) {
      logInfo("RewardsPolling", `Could not parse event name from activity: ${activityName}, skipping`);
      continue;
    }

    let actionType: "deposit" | "withdraw" | "occurred";
    if (activity.activityType === "OneTime") {
      actionType = "occurred";
    } else {
      actionType = eventName === "Deposited" ? "deposit" : "withdraw";
    }

    mappings.push({
      contractAddress: activity.allowedCaller,
      eventName,
      activityId: activity.activityId,
      actionType,
    });
  }

  return mappings;
};

const mapEventToAction = (event: ProtocolEvent, mapping: EventMapping): RewardsAction => {
  return {
    activityId: mapping.activityId,
    user: event.user,
    amount: event.amount,
    actionType: mapping.actionType,
  };
};

const processBatch = async <T>(
  actions: T[],
  batchFn: (batch: NonEmptyArray<T>) => Promise<void>,
  batchType: string,
): Promise<void> => {
  if (actions.length === 0) return;

  const maxBatchSize = config.polling.maxBatchSize;
  for (let i = 0; i < actions.length; i += maxBatchSize) {
    const batch = actions.slice(i, i + maxBatchSize) as NonEmptyArray<T>;
    try {
      await batchFn(batch);
      logInfo("RewardsPolling", `Processed ${batch.length} ${batchType} actions (batch ${Math.floor(i / maxBatchSize) + 1})`);
    } catch (error) {
      logError("RewardsPolling", error as Error, {
        operation: `processBatch-${batchType}`,
        batchIndex: Math.floor(i / maxBatchSize) + 1,
        batchSize: batch.length,
      });
      throw error;
    }
  }
};

const processEvents = async (): Promise<void> => {
  try {
    await checkBalances();

    if (eventMappings.length === 0) {
      logInfo("RewardsPolling", "No event mappings available, reloading activities...");
      await loadActivities();
      if (eventMappings.length === 0) {
        logError("RewardsPolling", new Error("No event mappings found after reload"), {
          operation: "processEvents",
        });
        return;
      }
    }

    const allActions: RewardsAction[] = [];
    const blockUpdates = new Map<string, number>();

    const contractAddresses = [...new Set(eventMappings.map(m => m.contractAddress))];
    const eventNames = [...new Set(eventMappings.map(m => m.eventName))];
    
    const lastBlocks = await Promise.all(
      eventMappings.map(async (m) => {
        const key = `${m.contractAddress}-${m.eventName}`;
        return await blockTrackingService.getLastProcessedBlock(key);
      })
    );
    
    const minLastBlock = lastBlocks.length > 0 ? Math.min(...lastBlocks) : 0;

    const allEvents = await getEventsBatch(
      contractAddresses,
      eventNames,
      minLastBlock,
    );

    const eventMappingByKey = new Map<string, EventMapping>();
    for (const mapping of eventMappings) {
      const key = `${mapping.contractAddress}-${mapping.eventName}`;
      eventMappingByKey.set(key, mapping);
    }

    const eventsByKey = new Map<string, ProtocolEvent[]>();
    for (const event of allEvents) {
      const key = `${event.contractAddress}-${event.eventName}`;
      if (!eventsByKey.has(key)) {
        eventsByKey.set(key, []);
      }
      eventsByKey.get(key)!.push(event);
    }

    for (const [key, events] of eventsByKey.entries()) {
      const mapping = eventMappingByKey.get(key);
      if (!mapping) {
        continue;
      }

      const lastBlock = await blockTrackingService.getLastProcessedBlock(key);
      const filteredEvents = events.filter(e => (e.blockNumber || 0) > lastBlock);

      if (filteredEvents.length > 0) {
        const actions = filteredEvents.map((event) => mapEventToAction(event, mapping));
        allActions.push(...actions);

        const maxBlock = Math.max(
          ...filteredEvents.map((e) => e.blockNumber || 0),
          lastBlock,
        );
        blockUpdates.set(key, maxBlock);

        logInfo("RewardsPolling", `Found ${filteredEvents.length} events for ${key}`, {
          lastBlock,
          maxBlock,
        });
      }
    }

    if (allActions.length === 0) {
      return;
    }

    const depositActions = allActions.filter((a) => a.actionType === "deposit");
    const withdrawActions = allActions.filter((a) => a.actionType === "withdraw");
    const occurredActions = allActions.filter((a) => a.actionType === "occurred");

    try {
      await processBatch(depositActions, depositBatch, "deposit");
      await processBatch(withdrawActions, withdrawBatch, "withdraw");
      await processBatch(occurredActions, occurredBatch, "occurred");

      await blockTrackingService.updateLastProcessedBlocks(blockUpdates);

      logInfo("RewardsPolling", `Processed ${allActions.length} total actions`, {
        deposits: depositActions.length,
        withdraws: withdrawActions.length,
        occurred: occurredActions.length,
      });
    } catch (error) {
      logError("RewardsPolling", error as Error, {
        operation: "processEvents-batch",
        note: "Block numbers not updated due to batch failure",
      });
      throw error;
    }
  } catch (error) {
    logError("RewardsPolling", error as Error, {
      operation: "processEvents",
    });
  }
};

export const startRewardsPolling = (): void => {
  const pollingInterval = config.polling.interval || 60 * 1000;

  const poll = async () => {
    await processEvents();
  };

  void poll();
  setInterval(poll, pollingInterval);

  logInfo("RewardsPolling", `Started rewards polling with interval ${pollingInterval}ms`);
};

const loadActivities = async (): Promise<void> => {
  try {
    activitiesCache = await getRewardsActivities();
    eventMappings = buildEventMappings(activitiesCache);

    logInfo("RewardsPolling", `Loaded ${activitiesCache.size} activities, built ${eventMappings.length} event mappings`);
    
    for (const mapping of eventMappings) {
      logInfo("RewardsPolling", `Mapped ${mapping.contractAddress}-${mapping.eventName} to activityId ${mapping.activityId} (${mapping.actionType})`);
    }
  } catch (error) {
    logError("RewardsPolling", error as Error, {
      operation: "loadActivities",
    });
    throw error;
  }
};

export const initializeRewardsPolling = async () => {
  logInfo("RewardsPolling", "Initializing rewards polling...");

  await loadActivities();

  for (const mapping of eventMappings) {
    const key = `${mapping.contractAddress}-${mapping.eventName}`;
    const lastBlock = await blockTrackingService.getLastProcessedBlock(key);
    if (lastBlock > 0) {
      logInfo("RewardsPolling", `Loaded last processed block for ${key}: ${lastBlock}`);
    }
  }

  startRewardsPolling();

  logInfo("RewardsPolling", "Rewards polling initialized");
};

