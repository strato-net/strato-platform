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
  assert.deepEqual(candlesFrom(state, "1m"), [
    [t0, 4, 9, 4, 9, 13, 2],
    [t0 + 60, 9, 9, 4, 4, 8, 1],
  ]);
  assert.deepEqual(candlesFrom(state, "1h"), [[t0, 4, 9, 4, 4, 21, 3]]);
  assert.deepEqual(candlesFrom(state, "1m", t0 + 60), [[t0 + 60, 9, 9, 4, 4, 8, 1]]);
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
  assert.equal(candlesFrom(state, "1m").length, 1);
  assert.equal(candlesFrom(state, "1m")[0][6], 2);
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
