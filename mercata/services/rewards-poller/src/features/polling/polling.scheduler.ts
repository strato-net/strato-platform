import { logInfo } from "../../infra/observability/logger";

export const startPollingLoop = (
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
