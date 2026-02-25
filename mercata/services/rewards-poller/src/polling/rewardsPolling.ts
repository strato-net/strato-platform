import cron from "node-cron";
import { config } from "../config";
import { logInfo, logError } from "../utils/logger";
import {
  getEventsBatch,
  getEventQueryParams,
  getBonusEligibleUsers,
} from "../services/cirrusService";
import {
  batchHandleAction,
  batchAddBonus,
} from "../services/rewardsService";
import { checkBalances } from "../utils/balanceCheck";
import { RewardsAction, NonEmptyArray, BonusCredit } from "../types";
import { blockTrackingService } from "../services/blockTrackingService";
import { bonusTrackingService } from "../services/bonusTrackingService";
import { nextCursorAfter } from "../utils/eventHelpers";
import { calculateBonusCreditsForUsers, getCronIntervalSeconds, MAX_BONUS_INTERVAL_SECONDS } from "../utils/bonusUtils";
import { isValidBonusCredit } from "../utils/bonusValidation";

const processEvents = async (): Promise<void> => {
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
        const errorMessage = (error as Error).message;
        const isContractFailure =
          errorMessage.includes("Error running the transaction") ||
          errorMessage.includes("solidity") ||
          errorMessage.includes("Transaction failed") ||
          errorMessage.includes("require failed");

        if (isContractFailure) {
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

const processBonus = async (): Promise<void> => {
  try {
    const tokenConfigs = config.bonus.tokenConfigs;
    if (tokenConfigs.length === 0) return;

    logInfo("RewardsBonusPolling", "Starting bonus polling cycle");
    await checkBalances();

    const state = await bonusTrackingService.getState();
    const bonusUsers = await getBonusEligibleUsers(tokenConfigs);

    const elapsed = state.lastSuccessfulTimestamp
      ? Math.floor((Date.now() - new Date(state.lastSuccessfulTimestamp).getTime()) / 1000)
      : getCronIntervalSeconds(config.bonus.cron);
    const intervalSeconds = Math.min(Math.max(1, elapsed), MAX_BONUS_INTERVAL_SECONDS);

    const newCredits = bonusUsers.length > 0
      ? await calculateBonusCreditsForUsers(bonusUsers, intervalSeconds)
      : [];

    const allCredits = [...state.pendingCredits, ...newCredits];
    const invalidCredit = allCredits.find((credit) => !isValidBonusCredit(credit));
    if (invalidCredit) {
      throw new Error("Invalid bonus credit state detected; refusing to apply bonus with missing fields");
    }
    if (allCredits.length === 0) {
      await bonusTrackingService.updateState({
        lastSuccessfulTimestamp: new Date().toISOString(),
        pendingCredits: [],
      });
      return;
    }

    if (state.pendingCredits.length > 0) {
      logInfo(
        "RewardsBonusPolling",
        `Retrying ${state.pendingCredits.length} pending + ${newCredits.length} new credits`
      );
    }

    await bonusTrackingService.clearPending();

    const maxBatchSize = config.polling.maxBatchSize;
    let applied = 0;

    for (let i = 0; i < allCredits.length; i += maxBatchSize) {
      const batch = allCredits.slice(i, i + maxBatchSize) as NonEmptyArray<BonusCredit>;
      try {
        await batchAddBonus(batch);
        applied += batch.length;
      } catch (error) {
        logError("RewardsBonusPolling", error as Error, {
          operation: "processBonus",
          message: "Batch failed - added to pending",
          batchSize: batch.length,
        });
        await bonusTrackingService.appendPending(batch);
      }
    }

    await bonusTrackingService.updateState({
      lastSuccessfulTimestamp: new Date().toISOString(),
      pendingCredits: (await bonusTrackingService.getState()).pendingCredits,
    });

    logInfo("RewardsBonusPolling", `Applied ${applied}/${allCredits.length} bonus credits`);
  } catch (error) {
    logError("RewardsBonusPolling", error as Error, { operation: "processBonus" });
  }
};

const startPollingLoop = (
  component: string,
  interval: number,
  fn: () => Promise<void>
): void => {
  const poll = async () => {
    await fn();
    setTimeout(poll, interval);
  };

  void poll();
  logInfo(component, `Started polling with interval ${interval}ms`);
};

export const startRewardsPolling = (): void => {
  startPollingLoop("RewardsPolling", config.polling.interval, processEvents);
};

export const startRewardsBonusPolling = (): void => {
  cron.schedule(config.bonus.cron, () => {
    void processBonus();
  });
  logInfo("RewardsBonusPolling", `Scheduled bonus polling with cron: ${config.bonus.cron}`);
};

export const initializeRewardsPolling = async () => {
  logInfo("RewardsPolling", "Initializing rewards polling...");

  await blockTrackingService.getCursor();

  startRewardsPolling();
  startRewardsBonusPolling();

  logInfo("RewardsPolling", "Rewards polling initialized");
};
