import { logError } from "./logger";

// Run poll, then wait pollingInterval after it settles before the next run, so runs never overlap
export const startNonOverlappingPolling = (
  component: string,
  operation: string,
  pollingInterval: number,
  poll: () => Promise<void>,
): void => {
  const run = async () => {
    try {
      await poll();
    } catch (e: any) {
      logError(component, e as Error, { operation });
    } finally {
      setTimeout(run, pollingInterval);
    }
  };

  void run();
};
