import { logError, logInfo } from "./logger";
import { WasConfig, WithdrawalAuditService } from "./types";

export interface WithdrawalAuditPoller {
  start(): void;
  stop(): void;
}

export const createWithdrawalAuditPoller = (
  config: WasConfig,
  service: WithdrawalAuditService,
): WithdrawalAuditPoller => {
  let interval: NodeJS.Timeout | undefined;

  const run = async () => {
    try {
      logInfo("Poller", "Poll started");
      await service.warmAuditCache();
      logInfo("Poller", "Poll completed");
    } catch (error) {
      logError("Poller", error as Error, { operation: "poll" });
    }
  };

  return {
    start: () => {
      if (interval) return;
      interval = setInterval(run, config.pollIntervalMs);
      logInfo("Poller", "Poller started", {
        pollIntervalMs: config.pollIntervalMs,
      });
    },

    stop: () => {
      if (!interval) return;
      clearInterval(interval);
      interval = undefined;
      logInfo("Poller", "Poller stopped");
    },
  };
};
