import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLadder, groupingDecimals, groupingOptions } from '../src/components/terminal/ladder.ts';

const Q96 = 2n ** 96n;
const L = 1e24;
// pool price 4 (sqrt 2), one full-range position
const distribution = {
  sqrtPriceX96: (2n * Q96).toString(),
  currentTick: 13863,
  tickSpacing: 60,
  liquidity: L.toString(),
  segments: [{ tickLower: -887220, tickUpper: 887220, liquidity: L.toString() }],
};
const base0 = { baseIsToken0: true, base: { decimals: 18 }, quote: { decimals: 18 } };
const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * 1e-9, `${actual} != ${expected}`);

test('levels follow the constant-liquidity formulas', () => {
  const ladder = buildLadder(distribution, base0, 1, 2);
  assert.equal(ladder.price, 4);
  // 4 -> 5: base = L(√5−2)/(2√5), quote = L(√5−2), in whole tokens
  const [ask1, ask2] = ladder.asks;
  assert.equal(ask1.price, 5);
  close(ask1.base, (1e6 * (Math.sqrt(5) - 2)) / (2 * Math.sqrt(5)));
  close(ask1.quote, 1e6 * (Math.sqrt(5) - 2));
  assert.equal(ask2.price, 6);
  close(ask2.totalQuote, 1e6 * (Math.sqrt(6) - 2));
  // 4 -> 3 on the bid side
  const [bid1] = ladder.bids;
  assert.equal(bid1.price, 3);
  close(bid1.quote, 1e6 * (2 - Math.sqrt(3)));
  close(bid1.base, (1e6 * (2 - Math.sqrt(3))) / (2 * Math.sqrt(3)));
});

test('the first level starts at the pool price, not at the grid', () => {
  const offGrid = { ...distribution, sqrtPriceX96: ((21n * Q96) / 10n).toString() }; // price 4.41
  const ladder = buildLadder(offGrid, base0, 1, 1);
  assert.equal(ladder.asks[0].price, 5);
  close(ladder.asks[0].quote, 1e6 * (Math.sqrt(5) - 2.1));
  assert.equal(ladder.bids[0].price, 4);
  close(ladder.bids[0].quote, 1e6 * (2.1 - 2));
});

test('liquidity outside every segment contributes nothing', () => {
  // only [tick 0, tick 13863) ≈ prices [1, 4): nothing above the pool price
  const bounded = { ...distribution, segments: [{ tickLower: 0, tickUpper: 13863, liquidity: L.toString() }] };
  const ladder = buildLadder(bounded, base0, 1, 5);
  assert.ok(ladder.asks.every((level) => level.base < 1e-3));
  // the whole segment sits on the bid side: 4 -> 1 trades ~L(2−1) quote in total (tick-rounded)
  assert.equal(ladder.bids.length, 3);
  assert.ok(Math.abs(ladder.bids[2].totalQuote - 1e6) < 1e3);
});

test('a market whose base is token1 mirrors the pool', () => {
  // pool price 4 token1 per token0 -> market price 0.25 token0 per token1
  const ladder = buildLadder(distribution, { ...base0, baseIsToken0: false }, 0.05, 1);
  assert.equal(ladder.price, 0.25);
  // market 0.25 -> 0.30 is pool √ 2 -> √(1/0.3): base (token1) leaves the pool
  const sqrtEdge = Math.sqrt(1 / 0.3);
  close(ladder.asks[0].price, 0.3);
  close(ladder.asks[0].base, 1e6 * (2 - sqrtEdge));
  close(ladder.asks[0].quote, (1e6 * (2 - sqrtEdge)) / (2 * sqrtEdge));
});

test('grouping options scale with the price', () => {
  assert.deepEqual(groupingOptions(2.17).map((g) => +g.toPrecision(3)), [0.01, 0.05, 0.1]);
  assert.deepEqual(groupingOptions(0.052).map((g) => +g.toPrecision(3)), [0.0001, 0.0005, 0.001]);
  assert.equal(groupingDecimals(0.01), 2);
  assert.equal(groupingDecimals(0.05), 2);
  assert.equal(groupingDecimals(10), 0);
});
