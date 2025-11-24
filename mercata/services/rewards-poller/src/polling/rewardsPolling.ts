import { config } from "../config";
import { logInfo, logError } from "../utils/logger";
import {
  getPoolDepositedEvents,
  getPoolWithdrawnEvents,
  getLiquidityPoolDepositedEvents,
  getLiquidityPoolWithdrawnEvents,
  getLendingPoolBorrowedEvents,
  getLendingPoolRepaidEvents,
} from "../services/cirrusService";
import {
  depositBatch,
  withdrawBatch,
  occurredBatch,
} from "../services/rewardsService";
import { blockTrackingService } from "../services/blockTrackingService";
import { checkBalances } from "../utils/balanceCheck";
import { ProtocolEvent, RewardsAction, EventMapping, NonEmptyArray } from "../types";

const EVENT_MAPPINGS: EventMapping[] = [
  { contractName: "Pool", eventName: "Deposited", activityId: 1, actionType: "deposit" },
  { contractName: "Pool", eventName: "Withdrawn", activityId: 1, actionType: "withdraw" },
  { contractName: "LiquidityPool", eventName: "Deposited", activityId: 2, actionType: "deposit" },
  { contractName: "LiquidityPool", eventName: "Withdrawn", activityId: 2, actionType: "withdraw" },
  { contractName: "LendingPool", eventName: "Borrowed", activityId: 3, actionType: "occurred" },
  { contractName: "LendingPool", eventName: "Repaid", activityId: 4, actionType: "occurred" },
];

const getEventFetcher = (contractName: string, eventName: string) => {
  if (contractName === "Pool" && eventName === "Deposited") return getPoolDepositedEvents;
  if (contractName === "Pool" && eventName === "Withdrawn") return getPoolWithdrawnEvents;
  if (contractName === "LiquidityPool" && eventName === "Deposited") return getLiquidityPoolDepositedEvents;
  if (contractName === "LiquidityPool" && eventName === "Withdrawn") return getLiquidityPoolWithdrawnEvents;
  if (contractName === "LendingPool" && eventName === "Borrowed") return getLendingPoolBorrowedEvents;
  if (contractName === "LendingPool" && eventName === "Repaid") return getLendingPoolRepaidEvents;
  return null;
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

    const allActions: RewardsAction[] = [];
    const blockUpdates = new Map<string, number>();

    for (const mapping of EVENT_MAPPINGS) {
      const key = `${mapping.contractName}-${mapping.eventName}`;
      const lastBlock = await blockTrackingService.getLastProcessedBlock(key);
      const fetcher = getEventFetcher(mapping.contractName, mapping.eventName);

      if (!fetcher) {
        logError("RewardsPolling", new Error(`No fetcher for ${key}`), {
          contractName: mapping.contractName,
          eventName: mapping.eventName,
        });
        continue;
      }

      const events = await fetcher(lastBlock);

      if (events.length > 0) {
        const actions = events.map((event) => mapEventToAction(event, mapping));
        allActions.push(...actions);

        const maxBlock = Math.max(
          ...events.map((e) => e.blockNumber || 0),
          lastBlock,
        );
        blockUpdates.set(key, maxBlock);

        logInfo("RewardsPolling", `Found ${events.length} ${key} events`, {
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

export const initializeRewardsPolling = async () => {
  logInfo("RewardsPolling", "Initializing rewards polling...");

  for (const mapping of EVENT_MAPPINGS) {
    const key = `${mapping.contractName}-${mapping.eventName}`;
    const lastBlock = await blockTrackingService.getLastProcessedBlock(key);
    if (lastBlock > 0) {
      logInfo("RewardsPolling", `Loaded last processed block for ${key}: ${lastBlock}`);
    }
  }

  startRewardsPolling();

  logInfo("RewardsPolling", "Rewards polling initialized");
};

