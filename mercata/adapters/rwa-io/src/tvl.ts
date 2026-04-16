import { config } from "./config";
import { fetchWithRetry } from "./fetchWithRetry";
import { logInfo, logError } from "./logger";
import { floorToHour } from "./time";
import { getTvlTimeSeriesId, pushRecords } from "./rwaIoClient";

interface TvlMetricsResponse {
  timestamp: string;
  totalUsd: string;
}

let cachedTsId: string | undefined;

/**
 * Fetch the current TVL from the STRATO metrics endpoint.
 * Returns the total USD value as a human-readable string (no decimals).
 */
async function fetchTvl(): Promise<{ totalUsd: string; timestamp: string }> {
  const res = await fetchWithRetry(config.strato.tvlEndpoint);

  if (!res.ok) {
    throw new Error(
      `GET ${config.strato.tvlEndpoint} failed: ${res.status} ${res.statusText}`
    );
  }

  const data = (await res.json()) as TvlMetricsResponse;

  // totalUsd from the STRATO endpoint is a BigInt string in WAD (10^18) units.
  const totalUsdWhole = parseFloat(
    (Number(BigInt(data.totalUsd)) / 1e18).toFixed(2)
  ).toString();

  return { totalUsd: totalUsdWhole, timestamp: data.timestamp };
}

/**
 * Main tick: fetch TVL from STRATO, push to RWA.io.
 */
export async function pushTvl(): Promise<void> {
  const { totalUsd, timestamp } = await fetchTvl();

  if (!cachedTsId) {
    cachedTsId = await getTvlTimeSeriesId();
  }

  const hourTimestamp = floorToHour(new Date(timestamp));

  logInfo("Fetched TVL from STRATO", { totalUsd, hourTimestamp });

  await pushRecords({
    tsId: cachedTsId,
    records: [{ timestamp: hourTimestamp, value: totalUsd }],
  });
}
