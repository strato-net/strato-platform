import { config } from "../../infra/config/runtimeConfig";
import { logInfo, logError } from "../../infra/observability/logger";
import { getBonusEligibleUsers } from "../events-read/bonusEligibility.reader";
import { batchAddBonus } from "../rewards-cycle/rewardsBatch.writer";
import { checkBalances } from "../rewards-cycle/rewardsBalance.guard";
import { NonEmptyArray, BonusCredit } from "../../shared/types";
import { bonusTrackingService } from "../../infra/state/bonusTracking.repo";
import {
  calculateBonusCreditsForUsers,
  getCronIntervalSeconds,
  MAX_BONUS_INTERVAL_SECONDS,
} from "./bonusCredit.calculator";
import { isValidBonusCredit } from "./bonusConfig.validator";

export const processBonusCycle = async (): Promise<void> => {
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
