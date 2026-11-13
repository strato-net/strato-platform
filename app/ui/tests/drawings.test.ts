import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type Drawing,
  formatDuration,
  hitsDrawing,
  measureStats,
  movePoint,
  newPosition,
  positionStats,
} from '../src/components/terminal/drawings.ts';

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

test('a new long aims above its entry and stops below, reward twice the risk; a short is the mirror', () => {
  const entry = { time: 1000, price: 100 };
  assert.deepEqual(newPosition('long', entry, 10, 600), [entry, { time: 1600, price: 110 }, { time: 1600, price: 95 }]);
  assert.deepEqual(newPosition('short', entry, 10, 600), [entry, { time: 1600, price: 90 }, { time: 1600, price: 105 }]);
  const stats = positionStats(newPosition('short', entry, 10, 600));
  near(stats.reward, 10);
  near(stats.risk, 5);
  near(stats.ratio!, 2);
});

test('a plan with its stop at the entry has no risk/reward ratio', () => {
  assert.equal(positionStats([{ time: 0, price: 100 }, { time: 1, price: 110 }, { time: 1, price: 100 }]).ratio, null);
});

test('dragging a point of a line moves only that point', () => {
  const line: Drawing = { id: 1, tool: 'trend', points: [{ time: 0, price: 1 }, { time: 10, price: 2 }] };
  assert.deepEqual(movePoint(line, 1, { time: 20, price: 5 }), [{ time: 0, price: 1 }, { time: 20, price: 5 }]);
});

test("a long's target stays above its entry, its stop below, and both share the end time", () => {
  const long: Drawing = { id: 1, tool: 'long', points: newPosition('long', { time: 1000, price: 100 }, 10, 600) };
  assert.deepEqual(movePoint(long, 1, { time: 2000, price: 120 }), [
    { time: 1000, price: 100 },
    { time: 2000, price: 120 },
    { time: 2000, price: 95 },
  ]);
  // dragged through the entry: held at it; dragged before the start: held at the start
  assert.deepEqual(movePoint(long, 1, { time: 500, price: 80 })[1], { time: 1000, price: 100 });
  assert.deepEqual(movePoint(long, 2, { time: 1600, price: 130 })[2], { time: 1600, price: 100 });
  assert.deepEqual(movePoint(long, 2, { time: 1600, price: 90 })[2], { time: 1600, price: 90 });
});

test("a short's target stays below its entry and its stop above", () => {
  const short: Drawing = { id: 1, tool: 'short', points: newPosition('short', { time: 1000, price: 100 }, 10, 600) };
  assert.equal(movePoint(short, 1, { time: 1600, price: 120 })[1].price, 100);
  assert.equal(movePoint(short, 1, { time: 1600, price: 70 })[1].price, 70);
  assert.equal(movePoint(short, 2, { time: 1600, price: 90 })[2].price, 100);
});

test("a plan's entry stays between its stop and target, and before its end", () => {
  const long: Drawing = { id: 1, tool: 'long', points: newPosition('long', { time: 1000, price: 100 }, 10, 600) };
  assert.deepEqual(movePoint(long, 0, { time: 1200, price: 104 })[0], { time: 1200, price: 104 });
  assert.deepEqual(movePoint(long, 0, { time: 5000, price: 200 })[0], { time: 1600, price: 110 });
  assert.equal(movePoint(long, 0, { time: 1200, price: 50 })[0].price, 95);
});

test('a measure reports the change, its percentage, the candles and the time', () => {
  const stats = measureStats([{ time: 3600, price: 200 }, { time: 3600 * 9, price: 150 }], 3600);
  assert.deepEqual(stats, { change: -50, changePct: -25, bars: 8, seconds: 28800 });
});

test('durations read as the two largest units', () => {
  assert.equal(formatDuration(45 * 60), '45m');
  assert.equal(formatDuration(3 * 3600), '3h');
  assert.equal(formatDuration(3 * 3600 + 15 * 60), '3h 15m');
  assert.equal(formatDuration(2 * 86400 + 4 * 3600 + 30 * 60), '2d 4h');
  assert.equal(formatDuration(-7200), '2h');
  assert.equal(formatDuration(0), '0m');
});

test('a trend line is hit along its length, not beyond its ends or beside it', () => {
  const line = [{ x: 0, y: 0 }, { x: 100, y: 100 }];
  assert.ok(hitsDrawing('trend', line, { x: 50, y: 53 }));
  assert.ok(!hitsDrawing('trend', line, { x: 50, y: 70 }));
  assert.ok(!hitsDrawing('trend', line, { x: 120, y: 120 }));
  // a line drawn onto a single point is still a place to hit
  assert.ok(hitsDrawing('trend', [{ x: 5, y: 5 }, { x: 5, y: 5 }], { x: 7, y: 7 }));
});

test('a horizontal line is hit anywhere along the chart', () => {
  assert.ok(hitsDrawing('horizontal', [{ x: 300, y: 40 }], { x: 5, y: 44 }));
  assert.ok(!hitsDrawing('horizontal', [{ x: 300, y: 40 }], { x: 5, y: 60 }));
});

test('a fibonacci is hit on its levels and its diagonal, not in the space between them', () => {
  const fib = [{ x: 0, y: 200 }, { x: 100, y: 0 }];
  assert.ok(hitsDrawing('fib', fib, { x: 30, y: 100 })); // the 0.5 level
  assert.ok(hitsDrawing('fib', fib, { x: 90, y: 200 * 0.618 })); // the 0.618 level
  assert.ok(hitsDrawing('fib', fib, { x: 85, y: 30 })); // on the diagonal
  assert.ok(!hitsDrawing('fib', fib, { x: 10, y: 60 })); // between levels, off the diagonal
  assert.ok(!hitsDrawing('fib', fib, { x: 150, y: 100 })); // beside it
});

test('a measure or a plan is hit anywhere inside its box', () => {
  const box = [{ x: 10, y: 10 }, { x: 110, y: 60 }];
  assert.ok(hitsDrawing('measure', box, { x: 60, y: 35 }));
  assert.ok(!hitsDrawing('measure', box, { x: 60, y: 80 }));
  const plan = [{ x: 0, y: 50 }, { x: 100, y: 0 }, { x: 100, y: 75 }];
  assert.ok(hitsDrawing('long', plan, { x: 50, y: 70 }));
  assert.ok(!hitsDrawing('long', plan, { x: 50, y: 90 }));
});
