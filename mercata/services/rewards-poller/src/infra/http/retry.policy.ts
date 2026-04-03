import { config } from "../config/runtimeConfig";
import { logInfo, logError } from "../observability/logger";
import { executeWithRetry } from "../../shared/core/retry";

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
  return executeWithRetry(fn, {
    maxAttempts,
    shouldRetry: (error) => isRetryableError(error),
    getDelayMs: (_error, attempt) =>
      Math.min(initialDelay * Math.pow(2, attempt - 1), maxDelay),
    onRetry: (error, attempt, delayMs) => {
      logInfo(context, `Retry attempt ${attempt}/${maxAttempts} after ${delayMs}ms`, {
        error: error.message,
      });
    },
    onFinalError: (error, attempts) => {
      logError(context, error, {
        operation: "retryWithBackoff",
        attempts,
        final: true,
      });
    },
  });
};
