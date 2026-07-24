/**
 * Dry-run script: fetches all token metrics from STRATO and logs them
 * without pushing to RWA.io. No API key required.
 *
 * Usage: RWA_IO_API_KEY=dry-run npx ts-node src/dry-run.ts
 */

import { config } from "./config";

const WAD_NUMBER = 1e18;

function wadToDecimal(raw: string, decimals = 6): string {
  return parseFloat((Number(BigInt(raw)) / WAD_NUMBER).toFixed(decimals)).toString();
}

async function main() {
  // Fetch shared data once
  const [priceRes, statsRes, tvlRes, poolsRes] = await Promise.all([
    fetch(`${config.strato.baseUrl}/api/oracle/price`),
    fetch(`${config.strato.baseUrl}/api/tokens/stats`),
    fetch(config.strato.tvlEndpoint),
    fetch(`${config.strato.baseUrl}/api/swap-pools`),
  ]);

  const prices = (await priceRes.json()) as { asset: string; price: string }[];
  const stats = (await statsRes.json()) as {
    tokens: { symbol: string; address: string; totalSupply: string; marketCap: string }[];
  };
  const tvl = (await tvlRes.json()) as {
    timestamp: string;
    assets: { symbol: string; address: string; totalUsd: string }[];
  };
  const pools = (await poolsRes.json()) as {
    tokenA: { _symbol: string; address: string };
    tokenB: { _symbol: string; address: string };
    tradingVolume24h: string;
  }[];

  const tvlAll = tvl as unknown as { totalUsd: string; timestamp: string };

  // --- Project-level series (slug=strato) ---
  console.log("\n=== PROJECT (STRATO) ===\n");
  const stratoAddr = config.strato.projectTokenAddress.toLowerCase();
  const stratoPriceEntry = prices.find((d) => d.asset.toLowerCase() === stratoAddr);
  const stratoStats = stats.tokens.find((t) => t.address.toLowerCase() === stratoAddr);
  const projPrice = stratoPriceEntry ? wadToDecimal(stratoPriceEntry.price, 6) : "NOT FOUND";
  const projMcap = stratoStats
    ? parseFloat(Number(stratoStats.marketCap).toFixed(2)).toString()
    : "NOT FOUND";
  const projTvl = tvlAll.totalUsd ? wadToDecimal(tvlAll.totalUsd, 2) : "0";
  let projRawVolume = 0n;
  for (const pool of pools) {
    if (pool.tradingVolume24h) projRawVolume += BigInt(pool.tradingVolume24h);
  }
  const projVolume = wadToDecimal(projRawVolume.toString(), 2);
  console.log(`  price:              $${projPrice}`);
  console.log(`  marketCap:          $${projMcap}`);
  console.log(`  tvl:                $${projTvl}`);
  console.log(`  aum:                $${projTvl}`);
  console.log(`  totalVolume (24h):  $${projVolume}`);

  for (const token of config.tokens) {
    console.log(`\n--- ${token.symbol} ---\n`);
    const addr = token.address.toLowerCase();

    // Price
    const priceEntry = prices.find((d) => d.asset.toLowerCase() === addr);
    const price = priceEntry
      ? wadToDecimal(priceEntry.price, 6)
      : "NOT FOUND";
    console.log(`  price:              $${price}`);

    // Supply & Market Cap
    const statsToken = stats.tokens.find(
      (t) => t.symbol === token.symbol || t.address.toLowerCase() === addr
    );
    const supply = statsToken
      ? wadToDecimal(statsToken.totalSupply, 6)
      : "NOT FOUND";
    const mcap = statsToken
      ? parseFloat(Number(statsToken.marketCap).toFixed(2)).toString()
      : "NOT FOUND";
    console.log(`  circulatingSupply:  ${supply}`);
    console.log(`  marketCap:          $${mcap}`);

    // AUM
    const tvlAsset = tvl.assets.find(
      (a) => a.symbol === token.symbol || a.address?.toLowerCase() === addr
    );
    const aum = tvlAsset
      ? wadToDecimal(tvlAsset.totalUsd, 2)
      : "0";
    console.log(`  aum:                $${aum}`);

    // NAV
    // NAV from raw WAD values to preserve precision
    const rawAum = tvlAsset ? BigInt(tvlAsset.totalUsd) : 0n;
    const rawSupply = statsToken ? BigInt(statsToken.totalSupply) : 0n;
    const nav = rawSupply > 0n
      ? parseFloat((Number(rawAum) / Number(rawSupply)).toFixed(6)).toString()
      : "0";
    console.log(`  nav:                $${nav}`);

    // Volume
    let totalVolume = BigInt(0);
    for (const pool of pools) {
      const has =
        pool.tokenA?._symbol === token.symbol ||
        pool.tokenB?._symbol === token.symbol ||
        pool.tokenA?.address?.toLowerCase() === addr ||
        pool.tokenB?.address?.toLowerCase() === addr;
      if (has && pool.tradingVolume24h) {
        totalVolume += BigInt(pool.tradingVolume24h);
      }
    }
    const volume = wadToDecimal(totalVolume.toString(), 2);
    console.log(`  volume (24h):       $${volume}`);
  }

  console.log(`\n  timestamp:          ${tvl.timestamp}`);
  console.log("\n--- Done ---");
}

main().catch(console.error);
