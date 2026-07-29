const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error ?? "Unknown error"));

export interface RetryEngineOptions {
  maxAttempts: number;
  normalizeError?: (error: unknown) => Error;
  shouldRetry?: (error: Error, attempt: number) => boolean;
  getDelayMs?: (error: Error, attempt: number) => number;
  onRetry?: (error: Error, attempt: number, delayMs: number) => void | Promise<void>;
  onFinalError?: (error: Error, attempts: number) => void | Promise<void>;
}

export const executeWithRetry = async <T>(
  fn: () => Promise<T>,
  options: RetryEngineOptions,
): Promise<T> => {
  const normalizeError = options.normalizeError ?? toError;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (rawError) {
      const error = normalizeError(rawError);
      lastError = error;

      if (attempt === options.maxAttempts) {
        await options.onFinalError?.(error, attempt);
        throw error;
      }

      if (options.shouldRetry && !options.shouldRetry(error, attempt)) {
        throw error;
      }

      const delayMs = Math.max(0, options.getDelayMs?.(error, attempt) ?? 0);
      await options.onRetry?.(error, attempt, delayMs);

      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError ?? new Error("Retry loop exited unexpectedly");
};
