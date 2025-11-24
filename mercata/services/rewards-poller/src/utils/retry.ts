import { config } from "../config";
import { logInfo, logError } from "./logger";

const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

const isRetryableError = (error: Error): boolean => {
  const errorMessage = error.message.toLowerCase();
  const retryablePatterns = [
    "timeout",
    "network",
    "connection",
    "econnrefused",
    "enotfound",
    "etimedout",
    "temporary",
    "retry",
  ];

  return retryablePatterns.some((pattern) => errorMessage.includes(pattern));
};

export const retryWithBackoff = async <T>(
  fn: () => Promise<T>,
  context: string,
  options?: {
    maxAttempts?: number;
    initialDelay?: number;
    maxDelay?: number;
  },
): Promise<T> => {
  const maxAttempts = options?.maxAttempts || config.retry.maxAttempts;
  const initialDelay = options?.initialDelay || config.retry.initialDelay;
  const maxDelay = options?.maxDelay || config.retry.maxDelay;

  let lastError: Error;
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxAttempts) {
        logError(context, lastError, {
          operation: "retryWithBackoff",
          attempts: attempt,
          final: true,
        });
        throw lastError;
      }

      if (!isRetryableError(lastError)) {
        logError(context, lastError, {
          operation: "retryWithBackoff",
          attempts: attempt,
          nonRetryable: true,
        });
        throw lastError;
      }

      logInfo(context, `Retry attempt ${attempt}/${maxAttempts} after ${delay}ms`, {
        error: lastError.message,
      });

      await sleep(delay);
      delay = Math.min(delay * 2, maxDelay);
    }
  }

  throw lastError!;
};

