const DAY_MS = 24 * 60 * 60 * 1000;
const SECONDS_PER_YEAR = 31_536_000;
const YIELD_ANCHOR_UTC_HOUR = 12;
const DEFAULT_YIELD_WINDOW_DAYS = 30;
const YIELD_ANCHOR_STEP_DAYS = 5;

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

function getHistoryValueAtAnchor(
  history: Map<string, YieldHistoryInterval[]>,
  key: string,
  anchorMs: number,
): string | null {
  const intervals = history.get(key);
  if (!intervals) return null;

  for (const interval of intervals) {
    if (interval.fromMs <= anchorMs && anchorMs <= interval.toMs) {
      return interval.value;
    }
  }

  return null;
}

function computeRatioFromRaw(tokenRaw: string, baseRaw: string): number | null {
  try {
    const token = BigInt(tokenRaw);
    const base = BigInt(baseRaw);
    if (token <= 0n || base <= 0n) return null;

    const scaledRatio = (token * 1_000_000_000n) / base;
    const ratio = Number(scaledRatio) / 1e9;
    return isFinite(ratio) && ratio > 0 ? ratio : null;
  } catch {
    return null;
  }
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

export function buildYieldAnchors(
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

export function computeYieldAPYFromAnchors(
  tokenAddress: string,
  baseAddress: string,
  currentPrices: Map<string, string>,
  history: Map<string, YieldHistoryInterval[]>,
  anchorsMs: number[],
): string | null {
  const ratioPoints: { anchorMs: number; ratio: number }[] = [];

  for (let i = 0; i < anchorsMs.length; i++) {
    const anchorMs = anchorsMs[i];
    const isToday = i === anchorsMs.length - 1;

    let tokenRaw = getHistoryValueAtAnchor(history, tokenAddress, anchorMs);
    let baseRaw = getHistoryValueAtAnchor(history, baseAddress, anchorMs);

    if (isToday) {
      tokenRaw = tokenRaw || currentPrices.get(tokenAddress) || null;
      baseRaw = baseRaw || currentPrices.get(baseAddress) || null;
    }

    if (!tokenRaw || !baseRaw) continue;

    const ratio = computeRatioFromRaw(tokenRaw, baseRaw);
    if (ratio === null) continue;

    ratioPoints.push({ anchorMs, ratio });
  }

  if (ratioPoints.length < 2) return null;

  const start = ratioPoints[0];
  const end = ratioPoints[ratioPoints.length - 1];
  const deltaSeconds = (end.anchorMs - start.anchorMs) / 1000;
  if (!isFinite(deltaSeconds) || deltaSeconds <= 0) return null;

  const growth = end.ratio / start.ratio;
  if (!isFinite(growth) || growth <= 0) return null;

  const apy = (Math.pow(growth, SECONDS_PER_YEAR / deltaSeconds) - 1) * 100;
  if (!isFinite(apy)) return null;

  return Math.max(0, apy).toFixed(2);
}
