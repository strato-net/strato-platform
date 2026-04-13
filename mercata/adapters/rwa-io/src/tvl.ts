import { config } from "./config";
import { logInfo, logError } from "./logger";
import { getTvlTimeSeriesId, pushRecords } from "./rwaIoClient";

const WAD = BigInt("1000000000000000000"); // 10^18

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
  const res = await fetch(config.strato.tvlEndpoint);

  if (!res.ok) {
    throw new Error(
      `GET ${config.strato.tvlEndpoint} failed: ${res.status} ${res.statusText}`
    );
  }

  const data = (await res.json()) as TvlMetricsResponse;

  // totalUsd from the STRATO endpoint is a BigInt string in WAD (10^18) units.
  // Convert to whole-dollar value for RWA.io.
  const totalUsdWad = BigInt(data.totalUsd);
  const totalUsdWhole = (totalUsdWad / WAD).toString();

  return { totalUsd: totalUsdWhole, timestamp: data.timestamp };
}

/**
 * Round a Date down to the start of the current UTC hour (RWA.io requirement
 * for hourly series).
 */
function floorToHour(date: Date): number {
  const d = new Date(date);
  d.setUTCMinutes(0, 0, 0);
  return d.getTime();
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
