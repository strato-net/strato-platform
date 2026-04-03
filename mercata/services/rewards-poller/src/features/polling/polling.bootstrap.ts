import cron from "node-cron";
import { config } from "../../infra/config/runtimeConfig";
import { logInfo } from "../../infra/observability/logger";
import { blockTrackingService } from "../../infra/state/blockTracking.repo";
import { processRewardsCycle } from "../rewards-cycle/rewardsCycle.processor";
import { processBonusCycle } from "../bonus-cycle/bonusCycle.processor";
import { startPollingLoop } from "./polling.scheduler";

export const startRewardsPolling = (): void => {
  startPollingLoop("RewardsPolling", config.polling.interval, processRewardsCycle);
};

export const startRewardsBonusPolling = (): void => {
  cron.schedule(config.bonus.cron, () => {
    void processBonusCycle();
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
