import { TokenApyEntry } from "@mercata/shared-types";
import { getServiceToken } from "../../utils/authHelper";
import { getTokenApys } from "./earn.service";

let cachedApys: TokenApyEntry[] | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
let refreshInFlight: Promise<void> | null = null;

const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export const getCachedTokenApys = (): TokenApyEntry[] | null => cachedApys;

async function refreshTokenApysCache(): Promise<void> {
  if (refreshInFlight) return;
  refreshInFlight = (async () => {
    try {
      const token = await getServiceToken();
      cachedApys = await getTokenApys(token);
      console.log(`[earn-cache] Refreshed token-apys cache (${cachedApys.length} tokens) at ${new Date().toISOString()}`);
    } catch (error) {
      console.error("[earn-cache] Failed to refresh token-apys cache:", error);
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export function startTokenApysRefresh(intervalMs: number = REFRESH_INTERVAL_MS): void {
  if (refreshTimer) return;
  refreshTokenApysCache();
  refreshTimer = setInterval(refreshTokenApysCache, intervalMs);
}

export function stopTokenApysRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}
