/**
 * Dry-run script: fetches all token metrics from STRATO and logs them
 * without pushing to RWA.io. No API key required.
 *
 * Usage: RWA_IO_API_KEY=dry-run npx ts-node src/dry-run.ts
 */

import { config } from "./config";

const WAD = BigInt("1000000000000000000");

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

  for (const token of config.tokens) {
    console.log(`\n--- ${token.symbol} ---\n`);
    const addr = token.address.toLowerCase();

    // Price
    const priceEntry = prices.find((d) => d.asset.toLowerCase() === addr);
    const price = priceEntry
      ? (BigInt(priceEntry.price) / WAD).toString()
      : "NOT FOUND";
    console.log(`  price:              $${price}`);

    // Supply & Market Cap
    const statsToken = stats.tokens.find(
      (t) => t.symbol === token.symbol || t.address.toLowerCase() === addr
    );
    const supply = statsToken
      ? (BigInt(statsToken.totalSupply) / WAD).toString()
      : "NOT FOUND";
    const mcap = statsToken
      ? Math.floor(Number(statsToken.marketCap)).toString()
      : "NOT FOUND";
    console.log(`  circulatingSupply:  ${supply}`);
    console.log(`  marketCap:          $${mcap}`);

    // AUM
    const tvlAsset = tvl.assets.find(
      (a) => a.symbol === token.symbol || a.address?.toLowerCase() === addr
    );
    const aum = tvlAsset
      ? (BigInt(tvlAsset.totalUsd) / WAD).toString()
      : "0";
    console.log(`  aum:                $${aum}`);

    // NAV
    const supplyBig = BigInt(supply === "NOT FOUND" ? "0" : supply);
    const nav = supplyBig > 0n ? (BigInt(aum) / supplyBig).toString() : "0";
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
    const volume = (totalVolume / WAD).toString();
    console.log(`  volume (24h):       $${volume}`);
  }

  console.log(`\n  timestamp:          ${tvl.timestamp}`);
  console.log("\n--- Done ---");
}

main().catch(console.error);
