import backfillRows from "../../config/exchangeRateBackfill.json";
import { constants } from "../../config/constants";
import { totalDebtFromScaled, calculateAPYs } from "./lending.helper";
import { safeBigInt } from "./vaultPerformance.helper";

const { DECIMALS, DAY_MS, BPS_DIVISOR } = constants;
const YIELD_ANCHOR_UTC_HOUR = 12;
const DEFAULT_YIELD_WINDOW_DAYS = 30;
const YIELD_ANCHOR_STEP_DAYS = 1;

export const ZERO_APY = "0.00";
export const DEFAULT_SWAP_FEE_BPS = 30;
export const DEFAULT_LP_SHARE_BPS = 7000;

export interface YieldHistoryInterval {
  fromMs: number;
  toMs: number;
  value: string;
}

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

export function buildYieldAnchorOverlapFilter(anchorsMs: number[]): string {
  return `(${anchorsMs
    .map((ms) => {
      const anchor = toCirrusUtcTime(new Date(ms));
      return `and(valid_from.lte.${anchor},valid_to.gte.${anchor})`;
    })
    .join(",")})`;
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
