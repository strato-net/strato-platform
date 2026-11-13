import assert from "node:assert/strict";
import test from "node:test";
import {
  MarketOrientation,
  RawSwapRow,
  candlesFrom,
  emptyMarketState,
  foldSwap,
  marketPrice,
  marketStats,
} from "../helpers/marketData.helper";
import { MAX_SQRT_RATIO } from "../helpers/poolV3Math.helper";

const FEE_ADDRESS = "f".repeat(40);
const TRADER = "a".repeat(40);
const Q96 = 2n ** 96n;
const WAD = 10n ** 18n;

const base0: MarketOrientation = { baseIsToken0: true, baseDecimals: 18, quoteDecimals: 18 };

/** sqrtPriceX96 for a whole-number square root (price = root²) */
const sqrtAt = (root: bigint): string => (root * Q96).toString();

const swap = (id: number, timestamp: string, amount0: bigint, amount1: bigint, root: bigint, recipient = TRADER): RawSwapRow => ({
  id,
  block_timestamp: timestamp,
  sender: TRADER,
  recipient,
  amount0: amount0.toString(),
  amount1: amount1.toString(),
  sqrtPriceX96: sqrtAt(root),
});

test("marketPrice orients and scales the pool price", () => {
  assert.equal(marketPrice(sqrtAt(2n), base0), 4);
  // base is token1: the market price is the inverse of the pool price
  assert.equal(marketPrice(sqrtAt(2n), { baseIsToken0: false, baseDecimals: 18, quoteDecimals: 18 }), 0.25);
  // 6-decimal base against an 18-decimal quote
  assert.equal(marketPrice(sqrtAt(10n ** 6n), { baseIsToken0: true, baseDecimals: 6, quoteDecimals: 18 }), 1);
});

test("foldSwap builds candles that open at the previous close", () => {
  const state = emptyMarketState();
  foldSwap(state, swap(1, "2026-11-11 10:00:05 UTC", -1n * WAD, 4n * WAD, 2n), base0, FEE_ADDRESS);
  foldSwap(state, swap(2, "2026-11-11 10:00:40 UTC", -1n * WAD, 9n * WAD, 3n), base0, FEE_ADDRESS);
  foldSwap(state, swap(3, "2026-11-11 10:01:10 UTC", 2n * WAD, -8n * WAD, 2n), base0, FEE_ADDRESS);

  const t0 = Date.parse("2026-11-11T10:00:00Z") / 1000;
  const now = (t0 + 90) * 1000;
  assert.deepEqual(candlesFrom(state, "1m", now), [
    [t0, 4, 9, 4, 9, 13, 2],
    [t0 + 60, 9, 9, 4, 4, 8, 1],
  ]);
  assert.deepEqual(candlesFrom(state, "1h", now), [[t0, 4, 9, 4, 4, 21, 3]]);
  assert.deepEqual(candlesFrom(state, "1m", now, t0 + 60), [[t0 + 60, 9, 9, 4, 4, 8, 1]]);
  assert.equal(state.lastId, 3);
  assert.equal(state.price, 4);
});

test("foldSwap records side, execution price and the gas tag on the tape", () => {
  const state = emptyMarketState();
  foldSwap(state, swap(1, "2026-11-11 10:00:05 UTC", -2n * WAD, 5n * WAD, 2n, FEE_ADDRESS), base0, FEE_ADDRESS);
  foldSwap(state, swap(2, "2026-11-11 10:00:06 UTC", 1n * WAD, -3n * WAD, 2n), base0, FEE_ADDRESS);

  assert.deepEqual(
    state.tape.map(({ side, price, amountBase, amountQuote, kind }) => ({ side, price, amountBase, amountQuote, kind })),
    [
      { side: "buy", price: 2.5, amountBase: 2, amountQuote: 5, kind: "gas" },
      { side: "sell", price: 3, amountBase: 1, amountQuote: 3, kind: "user" },
    ]
  );
});

test("a swap stamped before the newest bucket folds into it", () => {
  const state = emptyMarketState();
  foldSwap(state, swap(1, "2026-11-11 10:05:00 UTC", -1n * WAD, 4n * WAD, 2n), base0, FEE_ADDRESS);
  foldSwap(state, swap(2, "2026-11-11 10:01:00 UTC", -1n * WAD, 9n * WAD, 3n), base0, FEE_ADDRESS);
  const candles = candlesFrom(state, "1m", Date.parse("2026-11-11T10:05:30Z"));
  assert.equal(candles.length, 1);
  assert.equal(candles[0][6], 2);
});

test("candlesFrom fills buckets without swaps flat at the previous close", () => {
  const state = emptyMarketState();
  foldSwap(state, swap(1, "2026-11-11 10:00:05 UTC", -1n * WAD, 4n * WAD, 2n), base0, FEE_ADDRESS);
  foldSwap(state, swap(2, "2026-11-11 10:03:00 UTC", -1n * WAD, 9n * WAD, 3n), base0, FEE_ADDRESS);

  const t0 = Date.parse("2026-11-11T10:00:00Z") / 1000;
  const now = (t0 + 5 * 60 + 20) * 1000;
  assert.deepEqual(candlesFrom(state, "1m", now), [
    [t0, 4, 4, 4, 4, 4, 1],
    [t0 + 60, 4, 4, 4, 4, 0, 0],
    [t0 + 120, 4, 4, 4, 4, 0, 0],
    [t0 + 180, 4, 9, 4, 9, 9, 1],
    [t0 + 240, 9, 9, 9, 9, 0, 0],
    [t0 + 300, 9, 9, 9, 9, 0, 0],
  ]);
  // a poll from inside a gap, and the newest-`limit` cap
  assert.deepEqual(candlesFrom(state, "1m", now, t0 + 120).map((c) => c[0]), [t0 + 120, t0 + 180, t0 + 240, t0 + 300]);
  assert.deepEqual(candlesFrom(state, "1m", now, 0, 2), [
    [t0 + 240, 9, 9, 9, 9, 0, 0],
    [t0 + 300, 9, 9, 9, 9, 0, 0],
  ]);
  // a server clock behind the chain still returns the newest candle
  assert.equal(candlesFrom(state, "1m", (t0 + 30) * 1000).length, 4);
  assert.deepEqual(candlesFrom(emptyMarketState(), "1m", now), []);
});

test("weekly candles open on Monday 00:00 UTC", () => {
  const state = emptyMarketState();
  // 2026-11-08 is a Sunday, 2026-11-09 a Monday
  foldSwap(state, swap(1, "2026-11-08 23:59:59 UTC", -1n * WAD, 4n * WAD, 2n), base0, FEE_ADDRESS);
  foldSwap(state, swap(2, "2026-11-09 00:00:00 UTC", -1n * WAD, 9n * WAD, 3n), base0, FEE_ADDRESS);
  foldSwap(state, swap(3, "2026-11-15 23:59:59 UTC", 2n * WAD, -8n * WAD, 2n), base0, FEE_ADDRESS);

  const monday = Date.parse("2026-11-09T00:00:00Z") / 1000;
  const week = 7 * 86400;
  const now = Date.parse("2026-11-25T12:00:00Z");
  assert.deepEqual(candlesFrom(state, "1w", now), [
    [monday - week, 4, 4, 4, 4, 4, 1],
    [monday, 4, 9, 4, 4, 17, 2],
    // weeks without swaps, through the one that holds `now`
    [monday + week, 4, 4, 4, 4, 0, 0],
    [monday + 2 * week, 4, 4, 4, 4, 0, 0],
  ]);
  // a poll from the newest candle on returns it alone; one from mid-week starts at the next Monday
  assert.deepEqual(candlesFrom(state, "1w", now, monday + 2 * week), [[monday + 2 * week, 4, 4, 4, 4, 0, 0]]);
  assert.equal(candlesFrom(state, "1w", now, monday + 1)[0][0], monday + week);
  // the other resolutions keep their epoch-aligned buckets
  assert.equal(candlesFrom(state, "1d", now)[0][0], Date.parse("2026-11-08T00:00:00Z") / 1000);
});

test("a swap that strands the pool at the tick bound is priced at its execution", () => {
  const state = emptyMarketState();
  const drained = { ...swap(1, "2026-11-11 10:00:00 UTC", -1n * WAD, 5n * WAD, 2n), sqrtPriceX96: (MAX_SQRT_RATIO - 1n).toString() };
  foldSwap(state, drained, base0, FEE_ADDRESS);
  assert.equal(state.price, 5);
  assert.deepEqual(candlesFrom(state, "1m", Date.parse("2026-11-11T10:00:30Z")), [[Date.parse("2026-11-11T10:00:00Z") / 1000, 5, 5, 5, 5, 5, 1]]);
});

test("a swap of a few wei is taped at the pool price", () => {
  const state = emptyMarketState();
  foldSwap(state, swap(1, "2026-11-11 10:00:00 UTC", 2n, -4501n, 47n), base0, FEE_ADDRESS);
  assert.equal(state.tape[0].price, 47 * 47);
});

test("marketStats covers only the trailing 24 hours", () => {
  const state = emptyMarketState();
  foldSwap(state, swap(1, "2026-11-09 10:00:00 UTC", -1n * WAD, 1n * WAD, 1n), base0, FEE_ADDRESS);
  foldSwap(state, swap(2, "2026-11-11 09:00:00 UTC", -1n * WAD, 4n * WAD, 2n, FEE_ADDRESS), base0, FEE_ADDRESS);
  foldSwap(state, swap(3, "2026-11-11 09:30:00 UTC", -1n * WAD, 9n * WAD, 3n), base0, FEE_ADDRESS);

  assert.deepEqual(marketStats(state, Date.parse("2026-11-11T10:00:00Z")), {
    price: 9,
    open24h: 1,
    high24h: 9,
    low24h: 1,
    changePct24h: 800,
    volumeQuote24h: 13,
    volumeBase24h: 2,
    gasVolumeQuote24h: 4,
    trades24h: 2,
  });
  // no swaps in the window: flat at the last price
  const quiet = marketStats(state, Date.parse("2026-11-20T00:00:00Z"));
  assert.equal(quiet.open24h, 9);
  assert.equal(quiet.changePct24h, 0);
  assert.equal(quiet.trades24h, 0);
});
