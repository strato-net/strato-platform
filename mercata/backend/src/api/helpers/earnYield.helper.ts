const DAY_MS = 24 * 60 * 60 * 1000;
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
  const daysDelta = (endMs - startMs) / (1000 * 60 * 60 * 24);
  if (daysDelta < 1) return null;

  const growth = Number(endRate) / Number(startRate);
  if (!isFinite(growth) || growth <= 0) return null;
  const apy = (Math.pow(growth, 365 / daysDelta) - 1) * 100;
  return apy > 0 && isFinite(apy) ? apy.toFixed(2) : null;
}
