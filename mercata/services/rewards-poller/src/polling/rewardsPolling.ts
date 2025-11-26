import { config } from "../config";
import { logInfo, logError } from "../utils/logger";
import {
  getEventsBatch,
  getRewardsActivities,
} from "../services/cirrusService";
import {
  batchHandleAction,
} from "../services/rewardsService";
import { checkBalances } from "../utils/balanceCheck";
import { ProtocolEvent, RewardsAction, EventMapping, NonEmptyArray, ActivityInfo } from "../types";

let eventMappings: EventMapping[] = [];

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

    const contractAddresses = [...new Set(eventMappings.map(m => m.contractAddress))];
    const eventNames = [...new Set(eventMappings.map(m => m.eventName))];

    const allEvents = await getEventsBatch(
      contractAddresses,
      eventNames,
    );

    const eventMappingByKey = new Map(
      eventMappings.map((m) => [`${m.contractAddress}-${m.eventName}`, m])
    );

    const allActions: RewardsAction[] = [];
    for (const event of allEvents) {
      const key = `${event.contractAddress}-${event.eventName}`;
      const mapping = eventMappingByKey.get(key);
      if (mapping) {
        allActions.push(mapEventToAction(event, mapping));
      }
    }

    if (allActions.length === 0) {
      return;
    }

    try {
      const maxBatchSize = config.polling.maxBatchSize;
      for (let i = 0; i < allActions.length; i += maxBatchSize) {
        const batch = allActions.slice(i, i + maxBatchSize) as NonEmptyArray<RewardsAction>;
        await batchHandleAction(batch);
      }

      logInfo("RewardsPolling", `Processed ${allActions.length} actions`);
    } catch (error) {
      logError("RewardsPolling", error as Error, {
        operation: "processEvents-batch",
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
  const pollingInterval = config.polling.interval;

  const poll = async () => {
    await processEvents();
  };

  void poll();
  setInterval(poll, pollingInterval);

  logInfo("RewardsPolling", `Started rewards polling with interval ${pollingInterval}ms`);
};

const loadActivities = async (): Promise<void> => {
  try {
    const activities = await getRewardsActivities();
    eventMappings = buildEventMappings(activities);

    logInfo("RewardsPolling", `Loaded ${activities.size} activities, built ${eventMappings.length} event mappings`);
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

  startRewardsPolling();

  logInfo("RewardsPolling", "Rewards polling initialized");
};

