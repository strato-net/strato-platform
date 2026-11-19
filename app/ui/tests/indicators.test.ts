import assert from 'node:assert/strict';
import test from 'node:test';
import { INDICATORS, bollinger, ema, macd, rsi, sma } from '../src/components/terminal/indicators.ts';

const near = (actual: number | null, expected: number, tolerance = 1e-9) =>
  assert.ok(actual !== null && Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected}`);

test('sma averages the last `period` values and is empty before that', () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.deepEqual(sma([1, 2], 3), [null, null]);
});

test('ema starts at the simple average, then weights the newest value 2/(period+1)', () => {
  const values = ema([1, 2, 3, 4, 5], 3);
  assert.deepEqual(values.slice(0, 2), [null, null]);
  near(values[2], 2);
  near(values[3], 4 * 0.5 + 2 * 0.5);
  near(values[4], 5 * 0.5 + 3 * 0.5);
});

test('bollinger bands sit `width` standard deviations around the average', () => {
  const { upper, middle, lower } = bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2);
  // the textbook series: mean 5, population standard deviation 2
  near(middle[7], 5);
  near(upper[7], 9);
  near(lower[7], 1);
  assert.equal(upper[6], null);
});

test('rsi matches the worked example from Wilder', () => {
  // closes from the widely used 14-period worked example; published values 70.46, 66.25, 66.48
  const closes = [
    44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0,
    46.03,
  ];
  const values = rsi(closes, 14);
  assert.equal(values[13], null);
  near(values[14], 70.46, 0.01);
  near(values[15], 66.25, 0.01);
  near(values[16], 66.48, 0.01);
});

test('rsi is 100 when the price only rises, 0 when it only falls, 50 when it does not move', () => {
  const rising = Array.from({ length: 20 }, (_, i) => 100 + i);
  assert.equal(rsi(rising, 14)[19], 100);
  near(rsi([...rising].reverse(), 14)[19], 0);
  assert.equal(rsi(new Array(20).fill(5), 14)[19], 50);
});

test('macd is fast minus slow EMA, with a signal line that starts `signal` bars later', () => {
  const closes = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.2);
  const { line, signal, histogram } = macd(closes, 12, 26, 9);
  assert.equal(line[24], null);
  near(line[25], ema(closes, 12)[25]! - ema(closes, 26)[25]!);
  assert.equal(signal[32], null);
  // the first signal value is the simple average of the first nine MACD values
  near(signal[33], (line.slice(25, 34) as number[]).reduce((a, b) => a + b, 0) / 9);
  near(histogram[39], line[39]! - signal[39]!);
  assert.equal(histogram[32], null);
});

test('macd of too short a series is empty', () => {
  const { line, signal, histogram } = macd([1, 2, 3]);
  assert.deepEqual([line, signal, histogram], [[null, null, null], [null, null, null], [null, null, null]]);
});

test('every indicator gives one value per candle on each plot', () => {
  const closes = Array.from({ length: 250 }, (_, i) => 50 + Math.cos(i / 7) * 3);
  for (const indicator of INDICATORS) {
    for (const plot of indicator.plots(closes)) {
      assert.equal(plot.values.length, closes.length, indicator.id);
      assert.ok(plot.values[249] !== null && Number.isFinite(plot.values[249]), indicator.id);
    }
  }
});
