import { config } from "./config";
import { logInfo } from "./logger";
import { floorToHour } from "./time";
import { pushRecords } from "./rwaIoClient";
import {
  fetchOraclePrices,
  fetchTokenStats,
  fetchSwapPools,
  fetchTvl,
  wadToDecimal,
} from "./tokenMetrics";

/**
 * Push the project-level ("slug=strato") time series to RWA.io.
 *
 * These represent the STRATO chain / project token rather than an individual
 * tokenized asset:
 *   - price / marketCap  ← the STRATO token (config.strato.projectTokenAddress)
 *   - tvl / aum          ← platform-wide totals from /api/metrics/tvl
 *   - totalVolume        ← 24h trading volume summed across every swap pool
 *
 * STRATO is not present in the TVL asset list or any swap pool, so its
 * aum/volume cannot come from the token itself; the project-level AUM and
 * volume are therefore chain-wide aggregates. AUM currently mirrors TVL
 * (total value locked) — the only chain-wide "assets under management" figure
 * STRATO exposes today.
 */
export async function pushProjectMetrics(): Promise<void> {
  const [oraclePrices, stats, tvl, pools] = await Promise.all([
    fetchOraclePrices(),
    fetchTokenStats(),
    fetchTvl(),
    fetchSwapPools(),
  ]);

  const stratoAddr = config.strato.projectTokenAddress.toLowerCase();
  const timestamp = floorToHour(new Date(tvl.timestamp));

  // Price — STRATO oracle price (WAD).
  const priceEntry = oraclePrices.find(
    (d) => d.asset.toLowerCase() === stratoAddr
  );
  if (!priceEntry) {
    throw new Error("STRATO project token not found in oracle price response");
  }
  const price = wadToDecimal(priceEntry.price, 6);

  // Market cap — STRATO stats (plain decimal USD, not WAD).
  const statsToken = stats.tokens.find(
    (t) => t.address.toLowerCase() === stratoAddr
  );
  if (!statsToken) {
    throw new Error("STRATO project token not found in /tokens/stats");
  }
  const marketCap = parseFloat(Number(statsToken.marketCap).toFixed(2)).toString();

  // TVL / AUM — platform-wide total (WAD USD). AUM mirrors TVL for now.
  const tvlUsd = wadToDecimal(tvl.totalUsd, 2);
  const aum = tvlUsd;

  // Total volume — sum 24h trading volume across every pool (WAD USD).
  let rawVolume = 0n;
  for (const pool of pools) {
    if (pool.tradingVolume24h) rawVolume += BigInt(pool.tradingVolume24h);
  }
  const totalVolume = wadToDecimal(rawVolume.toString(), 2);

  logInfo("Fetched project metrics from STRATO", {
    price,
    marketCap,
    tvl: tvlUsd,
    aum,
    totalVolume,
    timestamp,
  });

  const ts = config.rwaIo.projectTimeSeries;
  const entries: { tsId: string; value: string }[] = [
    { tsId: ts.price, value: price },
    { tsId: ts.marketCap, value: marketCap },
    { tsId: ts.tvl, value: tvlUsd },
    { tsId: ts.aum, value: aum },
    { tsId: ts.totalVolume, value: totalVolume },
  ];

  await Promise.all(
    entries.map(({ tsId, value }) =>
      pushRecords({ tsId, records: [{ timestamp, value }] })
    )
  );
}
