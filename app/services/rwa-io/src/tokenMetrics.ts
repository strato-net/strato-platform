import { config } from "./config";
import { fetchWithRetry } from "./fetchWithRetry";
import { logInfo } from "./logger";
import { floorToHour } from "./time";
import {
  pushTokenizedAssetRecords,
  TokenizedAssetTimeSeriesIds,
} from "./rwaIoClient";

const WAD_NUMBER = 1e18;

/**
 * Convert a WAD-scaled BigInt string to a decimal string with up to `decimals`
 * fractional digits (trailing zeros stripped).
 */
export function wadToDecimal(raw: string, decimals = 6): string {
  const n = Number(BigInt(raw)) / WAD_NUMBER;
  return parseFloat(n.toFixed(decimals)).toString();
}

export interface TokenConfig {
  address: string;
  symbol: string;
  rwaIoAssetId: string;
  timeSeries: TokenizedAssetTimeSeriesIds;
}

interface TokenMetrics {
  price: string;
  circulatingSupply: string;
  marketCap: string;
  aum: string;
  nav: string;
  volume: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// STRATO data fetchers (shared across all tokens)
// ---------------------------------------------------------------------------

export interface OraclePrice {
  asset: string;
  price: string;
}

// Cache oracle prices per tick so we only fetch once for all tokens.
let oraclePricesCache: OraclePrice[] | undefined;

export async function fetchOraclePrices(): Promise<OraclePrice[]> {
  if (oraclePricesCache) return oraclePricesCache;

  const url = `${config.strato.baseUrl}/api/oracle/price`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);

  oraclePricesCache = (await res.json()) as OraclePrice[];
  return oraclePricesCache;
}

export interface TokenStatsToken {
  address: string;
  symbol: string;
  totalSupply: string;
  marketCap: string;
}

export interface TokenStatsResponse {
  tokens: TokenStatsToken[];
}

let tokenStatsCache: TokenStatsResponse | undefined;

export async function fetchTokenStats(): Promise<TokenStatsResponse> {
  if (tokenStatsCache) return tokenStatsCache;

  const url = `${config.strato.baseUrl}/api/tokens/stats`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);

  tokenStatsCache = (await res.json()) as TokenStatsResponse;
  return tokenStatsCache;
}

interface TvlAsset {
  symbol: string;
  address: string;
  totalUsd: string;
}

interface TvlResponse {
  timestamp: string;
  totalUsd: string;
  assets: TvlAsset[];
}

let tvlCache: TvlResponse | undefined;

export async function fetchTvl(): Promise<TvlResponse> {
  if (tvlCache) return tvlCache;

  const url = config.strato.tvlEndpoint;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);

  tvlCache = (await res.json()) as TvlResponse;
  return tvlCache;
}

interface PoolToken {
  address: string;
  _symbol: string;
}

export interface SwapPool {
  address: string;
  tokenA: PoolToken;
  tokenB: PoolToken;
  tradingVolume24h: string;
}

let swapPoolsCache: SwapPool[] | undefined;

export async function fetchSwapPools(): Promise<SwapPool[]> {
  if (swapPoolsCache) return swapPoolsCache;

  const url = `${config.strato.baseUrl}/api/swap-pools`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);

  swapPoolsCache = (await res.json()) as SwapPool[];
  return swapPoolsCache;
}

/**
 * Clear per-tick caches. Call once at the start of each tick so that both
 * tokens see fresh data but we don't duplicate HTTP requests within a tick.
 */
export function clearCaches(): void {
  oraclePricesCache = undefined;
  tokenStatsCache = undefined;
  tvlCache = undefined;
  swapPoolsCache = undefined;
}

// ---------------------------------------------------------------------------
// Per-token metric extraction
// ---------------------------------------------------------------------------

async function fetchMetricsForToken(token: TokenConfig): Promise<TokenMetrics> {
  const [oraclePrices, stats, tvl, pools] = await Promise.all([
    fetchOraclePrices(),
    fetchTokenStats(),
    fetchTvl(),
    fetchSwapPools(),
  ]);

  const addr = token.address.toLowerCase();

  // Price
  const priceEntry = oraclePrices.find(
    (d) => d.asset.toLowerCase() === addr
  );
  if (!priceEntry) {
    throw new Error(`${token.symbol} not found in oracle price response`);
  }
  const price = wadToDecimal(priceEntry.price, 6);

  // Circulating Supply & Market Cap
  const statsToken = stats.tokens.find(
    (t) => t.symbol === token.symbol || t.address.toLowerCase() === addr
  );
  if (!statsToken) {
    throw new Error(
      `${token.symbol} not found in /tokens/stats. Available: ${stats.tokens.map((t) => t.symbol).join(", ")}`
    );
  }
  const circulatingSupply = wadToDecimal(statsToken.totalSupply, 6);
  const marketCap = parseFloat(Number(statsToken.marketCap).toFixed(2)).toString();

  // AUM from TVL
  const tvlAsset = (tvl.assets ?? []).find(
    (a) => a.symbol === token.symbol || a.address?.toLowerCase() === addr
  );
  const aum = tvlAsset ? wadToDecimal(tvlAsset.totalUsd, 2) : "0";

  // NAV = AUM / Circulating Supply (computed from raw WAD values to preserve precision)
  const rawAum = tvlAsset ? BigInt(tvlAsset.totalUsd) : 0n;
  const rawSupply = BigInt(statsToken.totalSupply);
  const nav = rawSupply > 0n
    ? parseFloat((Number(rawAum) / Number(rawSupply)).toFixed(6)).toString()
    : "0";

  // Volume — sum 24h volume across all pools containing this token
  let totalVolume = BigInt(0);
  for (const pool of pools) {
    const hasToken =
      pool.tokenA?.address?.toLowerCase() === addr ||
      pool.tokenB?.address?.toLowerCase() === addr ||
      pool.tokenA?._symbol === token.symbol ||
      pool.tokenB?._symbol === token.symbol;

    if (hasToken && pool.tradingVolume24h) {
      totalVolume += BigInt(pool.tradingVolume24h);
    }
  }
  const volume = wadToDecimal(totalVolume.toString(), 2);

  const timestamp = floorToHour(new Date(tvl.timestamp));

  return { price, circulatingSupply, marketCap, aum, nav, volume, timestamp };
}

// ---------------------------------------------------------------------------
// Push to RWA.io
// ---------------------------------------------------------------------------

export async function pushTokenMetrics(token: TokenConfig): Promise<void> {
  const metrics = await fetchMetricsForToken(token);
  const tsIds = token.timeSeries;

  logInfo(`Fetched ${token.symbol} metrics from STRATO`, {
    symbol: token.symbol,
    price: metrics.price,
    circulatingSupply: metrics.circulatingSupply,
    marketCap: metrics.marketCap,
    aum: metrics.aum,
    nav: metrics.nav,
    volume: metrics.volume,
    timestamp: metrics.timestamp,
  });

  const entries: { tsId: string; value: string }[] = [
    { tsId: tsIds.price, value: metrics.price },
    { tsId: tsIds.circulatingSupply, value: metrics.circulatingSupply },
    { tsId: tsIds.marketCap, value: metrics.marketCap },
    { tsId: tsIds.aum, value: metrics.aum },
    { tsId: tsIds.nav, value: metrics.nav },
    { tsId: tsIds.volume, value: metrics.volume },
  ];

  await Promise.all(
    entries.map(({ tsId, value }) =>
      pushTokenizedAssetRecords(token.rwaIoAssetId, {
        tsId,
        records: [{ timestamp: metrics.timestamp, value }],
      })
    )
  );
}
