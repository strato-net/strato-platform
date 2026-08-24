import { log } from "../log";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryable = (error: any): boolean => {
  const status = error?.status ?? error?.statusCode;
  if (status === 408 || status === 409 || status === 429 || (typeof status === "number" && status >= 500)) return true;
  const code = error?.code ?? error?.cause?.code;
  if (["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "EPIPE", "UND_ERR_SOCKET"].includes(code)) return true;
  const name = error?.constructor?.name ?? "";
  return name === "APIConnectionError" || name === "APIConnectionTimeoutError";
};

// Provider SDKs already retry a couple of times; this outer loop covers
// sustained rate limiting / outages without failing an hour-long agent run.
export const withRetry = async <T>(label: string, fn: () => Promise<T>, attempts = 7): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      if (!isRetryable(error) || attempt === attempts) throw error;
      const retryAfter = Number(error?.headers?.["retry-after"] ?? error?.headers?.get?.("retry-after"));
      const base = Math.min(120_000, 2000 * 2 ** (attempt - 1));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : base + Math.random() * 1000;
      log.warn("LLM", `${label}: transient error (attempt ${attempt}/${attempts}), retrying in ${Math.round(delay / 1000)}s: ${error?.message ?? error}`);
      await sleep(delay);
    }
  }
  throw lastError;
};
