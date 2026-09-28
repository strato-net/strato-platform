import cron from "node-cron";
import { config } from "../../infra/config/runtimeConfig";
import { logInfo } from "../../infra/observability/logger";
import { blockTrackingService } from "../../infra/state/blockTracking.repo";
import { processRewardsCycle } from "../rewards-cycle/rewardsCycle.processor";
import { processBonusCycle } from "../bonus-cycle/bonusCycle.processor";
import { startPollingLoop } from "./polling.scheduler";
import { fetch } from "../../infra/http/api";
import { PositionEventSource } from "../../shared/types";
import { selectPositionEventSources } from "../../infra/config/positionEventSource.validator";

export const startRewardsPolling = (
  positionEventSources: PositionEventSource[]
): void => {
  startPollingLoop(
    "RewardsPolling",
    config.polling.interval,
    () => processRewardsCycle(positionEventSources)
  );
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
  const metadata = await fetch.get<{ networkID: string }>(
    `${config.api.nodeUrl}/strato-api/eth/v1.2/metadata`
  );
  const positionEventSources = selectPositionEventSources(
    config.positionEventSources,
    metadata.networkID
  );
  logInfo(
    "RewardsPolling",
    `Loaded ${positionEventSources.length} position event sources for network ${metadata.networkID}`
  );

  startRewardsPolling(positionEventSources);
  startRewardsBonusPolling();

  logInfo("RewardsPolling", "Rewards polling initialized");
};
