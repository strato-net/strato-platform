import { logError } from "./logger";

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 1000;

/**
 * Wrapper around fetch that retries on transient failures (network errors and
 * 5xx responses). Retries up to MAX_RETRIES times with exponential backoff.
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, init);

      if (res.status >= 500 && attempt < MAX_RETRIES) {
        logError(`HTTP ${res.status} from ${url}, retrying (${attempt + 1}/${MAX_RETRIES})`);
        await sleep(BASE_DELAY_MS * 2 ** attempt);
        continue;
      }

      return res;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        logError(`Network error fetching ${url}, retrying (${attempt + 1}/${MAX_RETRIES})`, err);
        await sleep(BASE_DELAY_MS * 2 ** attempt);
      }
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
