import backfillRows from "../../config/exchangeRateBackfill.json";
import { constants } from "../../config/constants";
import { cirrus } from "../../utils/appApiHelper";
import { totalDebtFromScaled, calculateAPYs } from "./lending.helper";
import { safeBigInt } from "./vaultPerformance.helper";

const { DECIMALS, DAY_MS, BPS_DIVISOR } = constants;
const YIELD_ANCHOR_UTC_HOUR = 12;
const DEFAULT_YIELD_WINDOW_DAYS = 30;
const YIELD_ANCHOR_STEP_DAYS = 1;
const MAX_YIELD_HISTORY_CACHE_KEYS = 8;
const YIELD_HISTORY_CACHE_TTL_MS = 60_000; // 60 seconds TTL to ensure consistent APY across backend instances
const RAY = 10n ** 27n;
const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

export const ZERO_APY = "0.00";
export const DEFAULT_SWAP_FEE_BPS = 30;
export const DEFAULT_LP_SHARE_BPS = 7000;

export interface YieldHistoryInterval {
  fromMs: number;
  toMs: number;
  value: string;
}

type YieldHistoryCacheEntry = {
  rows: YieldHistoryRow[];
  expiry: number;
};

const yieldHistoryCache = new Map<string, YieldHistoryCacheEntry>();
// Dedupes concurrent refreshes for the same cache key.
const pendingYieldHistoryFetches = new Map<string, Promise<YieldHistoryRow[]>>();

type YieldHistoryRow = {
  key?: string;
  value?: string;
  valid_from?: string;
  valid_to?: string;
};

type YieldExchangeRateQuery = {
  priceOracle: string;
  exchangeRateAddrs: string[];
  windowStart: string;
  windowEndExclusive: string;
  anchorsMs: number[];
};

function parseCirrusTimestamp(ts?: string): number {
  if (!ts) return Number.NaN;
  if (ts === "infinity") return Number.POSITIVE_INFINITY;
  if (ts === "-infinity") return Number.NEGATIVE_INFINITY;

  const hasTimezone = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(ts);
  return Date.parse(hasTimezone ? ts : `${ts}Z`);
}

export function indexYieldHistoryRows(rows: any[]): Map<string, YieldHistoryInterval[]> {
  const byKey = new Map<string, YieldHistoryInterval[]>();
  for (const row of rows) {
    const key = row?.key;
    if (!key) continue;

    const fromMs = parseCirrusTimestamp(row.valid_from);
    const toMs = parseCirrusTimestamp(row.valid_to);
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) continue;

    const interval: YieldHistoryInterval = {
      fromMs,
      toMs,
      value: row.value || "0",
    };

    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(interval);
  }

  for (const intervals of byKey.values()) {
    intervals.sort((a, b) => b.fromMs - a.fromMs);
  }

  return byKey;
}

export function computePerSecondRateApy(perSecondRateRaw: string | null | undefined): string {
  const perSecondRate = safeBigInt(perSecondRateRaw);
  if (perSecondRate <= RAY) return ZERO_APY;

  const apy = (Math.pow(Number(perSecondRate) / Number(RAY), SECONDS_PER_YEAR) - 1) * 100;
  return Number.isFinite(apy) ? apy.toFixed(2) : "-";
}

function buildYieldAnchors(
  nowMs: number,
  days: number = DEFAULT_YIELD_WINDOW_DAYS,
  stepDays: number = YIELD_ANCHOR_STEP_DAYS,
): number[] {
  const now = new Date(nowMs);
  const todayUtcStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const anchors: number[] = [];
  const step = Math.max(1, stepDays);

  for (let i = days - 1; i > 0; i -= step) {
    const dayStartMs = todayUtcStartMs - i * DAY_MS;
    anchors.push(dayStartMs + YIELD_ANCHOR_UTC_HOUR * 60 * 60 * 1000);
  }
  anchors.push(todayUtcStartMs + YIELD_ANCHOR_UTC_HOUR * 60 * 60 * 1000);

  return anchors;
}

function toCirrusUtcTime(d: Date): string {
  return d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function buildYieldAnchorOverlapFilter(anchorsMs: number[]): string {
  return `(${anchorsMs
    .map((ms) => {
      const anchor = toCirrusUtcTime(new Date(ms));
      return `and(valid_from.lte.${anchor},valid_to.gte.${anchor})`;
    })
    .join(",")})`;
}

function normalizeAddresses(addresses: string[]): string[] {
  const out = new Set<string>();
  for (const address of addresses) if (address) out.add(address.toLowerCase());
  return [...out].sort();
}

function buildYieldCacheKey(
  query: YieldExchangeRateQuery,
  addresses: string[],
): string {
  const { priceOracle, windowStart, windowEndExclusive } = query;
  return `${priceOracle.toLowerCase()}|${windowStart}|${windowEndExclusive}|${addresses.join(",")}`;
}

function setYieldHistoryCacheEntry(cacheKey: string, rows: YieldHistoryRow[]): void {
  if (yieldHistoryCache.has(cacheKey)) yieldHistoryCache.delete(cacheKey);
  yieldHistoryCache.set(cacheKey, { rows, expiry: Date.now() + YIELD_HISTORY_CACHE_TTL_MS });

  if (yieldHistoryCache.size > MAX_YIELD_HISTORY_CACHE_KEYS) {
    const oldestKey = yieldHistoryCache.keys().next().value;
    if (oldestKey) yieldHistoryCache.delete(oldestKey);
  }
}

async function fetchYieldExchangeRateRows(
  accessToken: string,
  query: YieldExchangeRateQuery,
  normalizedAddrs: string[],
): Promise<YieldHistoryRow[]> {
  const { priceOracle, windowStart, windowEndExclusive, anchorsMs } = query;
  const { data } = await cirrus.get(accessToken, "/history@mapping", {
    params: {
      address: `eq.${priceOracle}`,
      collection_name: "eq.exchangeRates",
      "key->>key": `in.(${normalizedAddrs.join(",")})`,
      select: "key->>key,value::text,valid_from,valid_to",
      and: `(block_timestamp.gte.${windowStart},block_timestamp.lt.${windowEndExclusive})`,
      or: buildYieldAnchorOverlapFilter(anchorsMs),
    },
  });
  return data ?? [];
}

export async function getYieldExchangeRateRowsCached(
  accessToken: string,
  query: YieldExchangeRateQuery,
): Promise<YieldHistoryRow[]> {
  const { exchangeRateAddrs } = query;
  const normalizedAddrs = normalizeAddresses(exchangeRateAddrs);
  if (normalizedAddrs.length === 0) return [];

  const cacheKey = buildYieldCacheKey(query, normalizedAddrs);
  const cached = yieldHistoryCache.get(cacheKey);
  const staleRows = cached?.rows ?? [];

  // Return cached data only if it exists and hasn't expired
  if (cached && cached.expiry > Date.now()) {
    return cached.rows;
  }

  const pending = pendingYieldHistoryFetches.get(cacheKey);
  if (pending) return pending;

  const fetchPromise = (async () => {
    try {
      const rows = await fetchYieldExchangeRateRows(accessToken, query, normalizedAddrs);
      setYieldHistoryCacheEntry(cacheKey, rows);
      return rows;
    } catch {
      return staleRows;
    } finally {
      pendingYieldHistoryFetches.delete(cacheKey);
    }
  })();

  pendingYieldHistoryFetches.set(cacheKey, fetchPromise);
  return fetchPromise;
}

export function getYieldWindowBounds(
  nowMs: number,
  days: number = DEFAULT_YIELD_WINDOW_DAYS,
): { windowStart: string; windowEndExclusive: string; anchorsMs: number[] } {
  const startDate = new Date(nowMs - (days - 1) * DAY_MS).toISOString().split("T")[0];
  const endDateExclusive = new Date(nowMs + DAY_MS).toISOString().split("T")[0];

  return {
    windowStart: `${startDate} 00:00:00 UTC`,
    windowEndExclusive: `${endDateExclusive} 00:00:00 UTC`,
    anchorsMs: buildYieldAnchors(nowMs, days),
  };
}

// Temporary: merge pre-fetched historical exchange rates with live Cirrus data.
// Remove once the oracle has 30+ days of real history.
export function mergeBackfillRows(cirrusRows: any[]): any[] {
  return [...backfillRows, ...cirrusRows];
}

export function computeExchangeRateAPY(
  assetAddress: string,
  history: Map<string, YieldHistoryInterval[]>,
  anchorsMs: number[],
): string | null {
  const intervals = history.get(assetAddress);
  if (!intervals || anchorsMs.length < 2) return null;

  let startRate: bigint | null = null, startMs = 0;
  let endRate: bigint | null = null, endMs = 0;

  for (const anchorMs of anchorsMs) {
    const iv = intervals.find(i => i.fromMs <= anchorMs && anchorMs <= i.toMs);
    if (!iv) continue;
    const rate = BigInt(iv.value || "0");
    if (rate <= 0n) continue;
    if (!startRate) { startRate = rate; startMs = anchorMs; }
    endRate = rate;
    endMs = anchorMs;
  }

  if (!startRate || !endRate || endMs <= startMs) return null;
  const daysDelta = (endMs - startMs) / DAY_MS;
  if (daysDelta < 1) return null;

  const growth = Number(endRate) / Number(startRate);
  if (!isFinite(growth) || growth <= 0) return null;
  const apy = (Math.pow(growth, 365 / daysDelta) - 1) * 100;
  return apy > 0 && isFinite(apy) ? apy.toFixed(2) : null;
}

// ── APY computation helpers ───────────────────────────────────────────────────

export function computeLendingAPY(lp: any, cfg: any, availableLiquidity: string): string | null {
  const { supplyAPY: maxSupplyAPY } = calculateAPYs(cfg.interestRate ?? 0, cfg.reserveFactor ?? 1000);
  const debt = BigInt(totalDebtFromScaled(lp.totalScaledDebt ?? "0", lp.borrowIndex ?? "0"));
  const cash = BigInt(availableLiquidity);
  const reserves = BigInt(lp.reservesAccrued ?? "0");
  const total = cash + debt;
  const denom = total - (reserves < total ? reserves : total);
  const util = denom > 0n ? Number(debt * BigInt(BPS_DIVISOR) / denom) / 100 : 0;
  const apy = maxSupplyAPY * (util / 100);
  return apy > 0 ? apy.toFixed(2) : null;
}

export function computeSafetyAPY(smRow: any, stRow: any, events: any[]): string | null {
  const totalAssetsNow = BigInt(smRow?._managedAssets ?? "0");
  const totalSharesNow = BigInt(stRow?._totalSupply ?? "0");
  if (totalSharesNow <= 0n) return null;

  let assetsDelta = 0n, sharesDelta = 0n;
  for (const e of events) {
    const a = e.attributes;
    switch (e.event_name) {
      case "Staked":          assetsDelta += BigInt(a.assetsIn ?? "0"); sharesDelta += BigInt(a.sharesOut ?? "0"); break;
      case "Redeemed":        assetsDelta -= BigInt(a.assetsOut ?? "0"); sharesDelta -= BigInt(a.sharesIn ?? "0"); break;
      case "RewardNotified":  assetsDelta += BigInt(a.amount ?? "0"); break;
      case "ShortfallCovered": assetsDelta -= BigInt(a.amount ?? "0"); break;
    }
  }

  const totalAssetsStart = totalAssetsNow - assetsDelta;
  const totalSharesStart = totalSharesNow - sharesDelta;
  if (totalSharesStart <= 0n || totalAssetsStart <= 0n) return null;

  const periodReturn = Number(totalAssetsNow) / Number(totalSharesNow) / (Number(totalAssetsStart) / Number(totalSharesStart)) - 1;
  if (periodReturn <= -1 || !isFinite(periodReturn)) return null;

  return ((Math.pow(1 + periodReturn, 365 / 30) - 1) * 100).toFixed(2);
}

export function computePoolAPY(pool: any, prices: Map<string, string>, volumeMap: Map<string, number>): string {
  const vol = volumeMap.get(pool.address) || 0;
  const feeRate = pool.swapFeeRate || DEFAULT_SWAP_FEE_BPS;
  const lpShare = pool.lpSharePercent || DEFAULT_LP_SHARE_BPS;
  const lpFees = vol * (feeRate / BPS_DIVISOR) * (lpShare / BPS_DIVISOR);
  const priceA = BigInt(prices.get(pool.tokenA.address) || "0");
  const priceB = BigInt(prices.get(pool.tokenB.address) || "0");
  const tvl = Number((BigInt(pool.tokenABalance || "0") * priceA + BigInt(pool.tokenBBalance || "0") * priceB) / DECIMALS) / 1e18;
  return (tvl > 0 ? (lpFees / tvl) * 365 * 100 : 0).toFixed(2);
}

export function weightedBaseYield(addrs: string[], bals: string[], prices: Map<string, string>, baseYields: Map<string, number>): string | null {
  let ws = 0, total = 0;
  for (let i = 0; i < addrs.length; i++) {
    const usd = Number((safeBigInt(bals[i]) * safeBigInt(prices.get(addrs[i]))) / DECIMALS) / 1e18;
    total += usd;
    ws += usd * (baseYields.get(addrs[i]) ?? 0);
  }
  return total > 0 && ws > 0 ? (ws / total).toFixed(2) : null;
}

export function buildVolumeMap(swapEvents: any[], prices: Map<string, string>): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of swapEvents) {
    const tokenIn = e.attributes?.tokenIn || e.tokenIn;
    const amountIn = e.attributes?.amountIn || e.amountIn || "0";
    const price = BigInt(prices.get(tokenIn) || "0");
    const volUSD = Number((BigInt(amountIn) * price) / DECIMALS) / 1e18;
    map.set(e.address, (map.get(e.address) || 0) + volUSD);
  }
  return map;
}
