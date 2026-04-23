import { config } from "./config";
import { logInfo } from "./logger";
import { floorToHour } from "./time";
import { pushRecords } from "./rwaIoClient";
import { fetchTvl } from "./tokenMetrics";

export async function pushTvl(): Promise<void> {
  const tvl = await fetchTvl();

  // totalUsd from the STRATO endpoint is a BigInt string in WAD (10^18) units.
  const totalUsd = parseFloat(
    (Number(BigInt(tvl.totalUsd)) / 1e18).toFixed(2)
  ).toString();

  const hourTimestamp = floorToHour(new Date(tvl.timestamp));

  logInfo("Fetched TVL from STRATO", { totalUsd, hourTimestamp });

  await pushRecords({
    tsId: config.rwaIo.projectTimeSeries.tvl,
    records: [{ timestamp: hourTimestamp, value: totalUsd }],
  });
}
