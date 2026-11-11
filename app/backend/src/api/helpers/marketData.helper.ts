/**
 * Trading-terminal market data: pure folds from PoolV3 Swap events to candles, a trade
 * tape and 24h stats. No I/O — the service feeds rows in ascending event-id order.
 */
import { CandleResolution, MarketCandle, MarketStats, MarketTrade } from "@strato/shared-types";

export const RESOLUTION_SECONDS: Record<CandleResolution, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
};
export const CANDLE_RESOLUTIONS = Object.keys(RESOLUTION_SECONDS) as CandleResolution[];

/** Candles kept per resolution (1m: 7 days, 5m: 30 days); the others keep everything */
const MAX_CANDLES: Partial<Record<CandleResolution, number>> = { "1m": 7 * 1440, "5m": 30 * 288 };
const TAPE_SIZE = 200;
const DAY_SECONDS = 86400;

/** How a pool maps onto a BASE/QUOTE market */
export interface MarketOrientation {
  baseIsToken0: boolean;
  baseDecimals: number;
  quoteDecimals: number;
}

/** A PoolV3 Swap event row (big uints selected with ::text casts) */
export interface RawSwapRow {
  id: number;
  block_timestamp: string; // "YYYY-MM-DD HH:MM:SS UTC"
  sender: string;
  recipient: string;
  amount0: string; // signed pool delta: positive = paid to the pool
  amount1: string;
  sqrtPriceX96: string; // pool price after the swap
}

interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  volumeQuote: number;
  volumeBase: number;
  gasVolumeQuote: number;
  count: number;
}

export interface MarketState {
  candles: Record<CandleResolution, Candle[]>;
  /** most recent trades, oldest first */
  tape: MarketTrade[];
  lastId: number;
  /** pool price after the latest swap, quote per base */
  price: number;
}

export const emptyMarketState = (): MarketState => ({
  candles: { "1m": [], "5m": [], "15m": [], "1h": [], "4h": [], "1d": [] },
  tape: [],
  lastId: 0,
  price: 0,
});

/** Pool price as quote per base in whole-token units, from a Q64.96 sqrt price */
export const marketPrice = (sqrtPriceX96: string, o: MarketOrientation): number => {
  const sqrt = Number(BigInt(sqrtPriceX96)) / 2 ** 96;
  const token1PerToken0 = sqrt * sqrt;
  if (token1PerToken0 === 0) return 0;
  return (o.baseIsToken0 ? token1PerToken0 : 1 / token1PerToken0) * 10 ** (o.baseDecimals - o.quoteDecimals);
};

/** Fold one swap into every candle resolution and the tape. Mutates `state`. */
export const foldSwap = (state: MarketState, row: RawSwapRow, o: MarketOrientation, feeAddress: string): void => {
  const [baseRaw, quoteRaw] = o.baseIsToken0
    ? [BigInt(row.amount0), BigInt(row.amount1)]
    : [BigInt(row.amount1), BigInt(row.amount0)];
  const amountBase = Math.abs(Number(baseRaw)) / 10 ** o.baseDecimals;
  const amountQuote = Math.abs(Number(quoteRaw)) / 10 ** o.quoteDecimals;
  const price = marketPrice(row.sqrtPriceX96, o);
  const kind = row.recipient === feeAddress ? "gas" : "user";
  const time = Date.parse(row.block_timestamp.replace(" UTC", "Z").replace(" ", "T"));

  for (const resolution of CANDLE_RESOLUTIONS) {
    const candles = state.candles[resolution];
    const seconds = RESOLUTION_SECONDS[resolution];
    const bucket = Math.floor(time / 1000 / seconds) * seconds;
    let candle = candles[candles.length - 1];
    // block timestamps are not guaranteed monotonic: a swap stamped before the newest
    // bucket folds into that bucket rather than rewriting history
    if (!candle || bucket > candle.t) {
      // a bucket opens at the previous close, so the first swap's move is inside it
      const open = candle ? candle.c : price;
      candle = { t: bucket, o: open, h: open, l: open, c: open, volumeQuote: 0, volumeBase: 0, gasVolumeQuote: 0, count: 0 };
      candles.push(candle);
      const max = MAX_CANDLES[resolution];
      if (max && candles.length > max) candles.shift();
    }
    candle.h = Math.max(candle.h, price);
    candle.l = Math.min(candle.l, price);
    candle.c = price;
    candle.volumeQuote += amountQuote;
    candle.volumeBase += amountBase;
    if (kind === "gas") candle.gasVolumeQuote += amountQuote;
    candle.count += 1;
  }

  state.tape.push({
    id: row.id,
    time,
    side: baseRaw < 0n ? "buy" : "sell",
    price: amountBase > 0 ? amountQuote / amountBase : price,
    amountBase,
    amountQuote,
    sender: row.sender,
    kind,
  });
  if (state.tape.length > TAPE_SIZE) state.tape.shift();
  state.lastId = row.id;
  state.price = price;
};

/** Candles at `resolution` with bucket start >= `from` (unix s), capped to the newest `limit` */
export const candlesFrom = (state: MarketState, resolution: CandleResolution, from = 0, limit = 1500): MarketCandle[] => {
  const candles = state.candles[resolution];
  let start = candles.length;
  while (start > 0 && candles[start - 1].t >= from && candles.length - start < limit) start--;
  return candles.slice(start).map((c) => [c.t, c.o, c.h, c.l, c.c, c.volumeQuote, c.count]);
};

/** Trailing-24h stats from the 1m candles (minute granularity at the window edge) */
export const marketStats = (state: MarketState, nowMs: number): MarketStats => {
  const since = Math.floor(nowMs / 1000) - DAY_SECONDS;
  const window = state.candles["1m"].filter((c) => c.t >= since);
  const open24h = window[0]?.o ?? state.price;
  const sum = (pick: (c: Candle) => number) => window.reduce((total, c) => total + pick(c), 0);
  return {
    price: state.price,
    open24h,
    high24h: window.reduce((high, c) => Math.max(high, c.h), open24h),
    low24h: window.reduce((low, c) => Math.min(low, c.l), open24h),
    changePct24h: open24h > 0 ? ((state.price - open24h) / open24h) * 100 : 0,
    volumeQuote24h: sum((c) => c.volumeQuote),
    volumeBase24h: sum((c) => c.volumeBase),
    gasVolumeQuote24h: sum((c) => c.gasVolumeQuote),
    trades24h: sum((c) => c.count),
  };
};
