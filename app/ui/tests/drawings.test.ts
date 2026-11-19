import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type Drawing,
  drawnPoints,
  hitsDrawing,
  lineSegment,
  measureStats,
  movePoint,
  rewardToRisk,
} from '../src/components/terminal/drawings.ts';

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);
const WIDTH = 500;

test('most tools keep the two ends they were drawn between', () => {
  const [from, to] = [{ time: 0, price: 1 }, { time: 10, price: 2 }];
  for (const tool of ['trend', 'ray', 'extended', 'arrow', 'fib', 'measure', 'rectangle', 'ellipse'] as const) {
    assert.deepEqual(drawnPoints(tool, from, to, 0.5), [from, to]);
  }
});

test("a channel's second line runs 60% of the move below the first, and no nearer than the minimum", () => {
  const from = { time: 0, price: 100 };
  assert.deepEqual(drawnPoints('channel', from, { time: 10, price: 110 }, 2)[2], { time: 10, price: 104 });
  assert.deepEqual(drawnPoints('channel', from, { time: 10, price: 101 }, 2)[2], { time: 10, price: 99 });
});

test('a long drawn by a drag aims as far as the drag went and stops at half of it; a short is the mirror', () => {
  const from = { time: 1000, price: 100 };
  assert.deepEqual(drawnPoints('long', from, { time: 1600, price: 110 }, 0), [
    from,
    { time: 1600, price: 110 },
    { time: 1600, price: 95 },
  ]);
  // dragged downwards and leftwards: still a long above its entry, starting at the earlier time
  assert.deepEqual(drawnPoints('long', from, { time: 400, price: 90 }, 0), [
    { time: 400, price: 100 },
    { time: 1000, price: 110 },
    { time: 1000, price: 95 },
  ]);
  const short = drawnPoints('short', from, { time: 1600, price: 110 }, 0);
  assert.deepEqual(short.slice(1), [{ time: 1600, price: 90 }, { time: 1600, price: 105 }]);
  near(rewardToRisk(short)!, 2);
});

test('a plan with its stop at the entry has no reward to risk', () => {
  assert.equal(rewardToRisk([{ time: 0, price: 100 }, { time: 1, price: 110 }, { time: 1, price: 100 }]), null);
});

test('dragging a point of a line moves only that point', () => {
  const line: Drawing = { id: 1, tool: 'trend', points: [{ time: 0, price: 1 }, { time: 10, price: 2 }] };
  assert.deepEqual(movePoint(line, 1, { time: 20, price: 5 }), [{ time: 0, price: 1 }, { time: 20, price: 5 }]);
});

test("a channel's second line keeps its distance when the first is reshaped, and changes it by its own point", () => {
  const channel: Drawing = { id: 1, tool: 'channel', points: drawnPoints('channel', { time: 0, price: 100 }, { time: 10, price: 110 }, 0) };
  assert.deepEqual(movePoint(channel, 1, { time: 20, price: 120 }), [
    { time: 0, price: 100 },
    { time: 20, price: 120 },
    { time: 20, price: 114 },
  ]);
  assert.deepEqual(movePoint(channel, 0, { time: 5, price: 90 })[2], { time: 10, price: 104 });
  // its own point sets only the distance: it stays at the end of the first line in time
  assert.deepEqual(movePoint(channel, 2, { time: 99, price: 101 })[2], { time: 10, price: 101 });
});

test("a long's target stays above its entry, its stop below, and both share the end time", () => {
  const long: Drawing = { id: 1, tool: 'long', points: drawnPoints('long', { time: 1000, price: 100 }, { time: 1600, price: 110 }, 0) };
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
  const short: Drawing = { id: 1, tool: 'short', points: drawnPoints('short', { time: 1000, price: 100 }, { time: 1600, price: 110 }, 0) };
  assert.equal(movePoint(short, 1, { time: 1600, price: 120 })[1].price, 100);
  assert.equal(movePoint(short, 1, { time: 1600, price: 70 })[1].price, 70);
  assert.equal(movePoint(short, 2, { time: 1600, price: 90 })[2].price, 100);
});

test("a plan's entry stays between its stop and target, and before its end", () => {
  const long: Drawing = { id: 1, tool: 'long', points: drawnPoints('long', { time: 1000, price: 100 }, { time: 1600, price: 110 }, 0) };
  assert.deepEqual(movePoint(long, 0, { time: 1200, price: 104 })[0], { time: 1200, price: 104 });
  assert.deepEqual(movePoint(long, 0, { time: 5000, price: 200 })[0], { time: 1600, price: 110 });
  assert.equal(movePoint(long, 0, { time: 1200, price: 50 })[0].price, 95);
});

test('a measure reports the change, its percentage and the hours', () => {
  assert.deepEqual(measureStats([{ time: 3600, price: 200 }, { time: 3600 * 9, price: 150 }]), {
    change: -50,
    changePct: -25,
    hours: 8,
  });
  assert.equal(measureStats([{ time: 1000, price: 1 }, { time: 100, price: 1 }]).hours, 0.3);
});

test('a ray runs on past its second point to the edge it points at; an extended line to both edges', () => {
  const [from, to] = [{ x: 100, y: 100 }, { x: 200, y: 150 }];
  assert.deepEqual(lineSegment('trend', from, to, WIDTH), [from, to]);
  assert.deepEqual(lineSegment('ray', from, to, WIDTH), [from, { x: 500, y: 300 }]);
  assert.deepEqual(lineSegment('ray', to, from, WIDTH), [to, { x: 0, y: 50 }]);
  assert.deepEqual(lineSegment('extended', from, to, WIDTH), [{ x: 0, y: 50 }, { x: 500, y: 300 }]);
});

test('a trend line is hit along its length, not beyond its ends or beside it', () => {
  const line = [{ x: 0, y: 0 }, { x: 100, y: 100 }];
  assert.ok(hitsDrawing('trend', line, { x: 50, y: 53 }, WIDTH));
  assert.ok(!hitsDrawing('trend', line, { x: 50, y: 70 }, WIDTH));
  assert.ok(!hitsDrawing('trend', line, { x: 120, y: 120 }, WIDTH));
  // a line drawn onto a single point is still a place to hit
  assert.ok(hitsDrawing('trend', [{ x: 5, y: 5 }, { x: 5, y: 5 }], { x: 7, y: 7 }, WIDTH));
});

test('a ray is hit beyond its second point but not behind its first; an extended line both ways', () => {
  const line = [{ x: 100, y: 100 }, { x: 200, y: 150 }];
  assert.ok(hitsDrawing('ray', line, { x: 400, y: 250 }, WIDTH));
  assert.ok(!hitsDrawing('ray', line, { x: 40, y: 70 }, WIDTH));
  assert.ok(hitsDrawing('extended', line, { x: 40, y: 70 }, WIDTH));
  assert.ok(hitsDrawing('extended', line, { x: 400, y: 250 }, WIDTH));
});

test('horizontal and vertical lines are hit anywhere along the chart', () => {
  assert.ok(hitsDrawing('horizontal', [{ x: 300, y: 40 }], { x: 5, y: 44 }, WIDTH));
  assert.ok(!hitsDrawing('horizontal', [{ x: 300, y: 40 }], { x: 5, y: 60 }, WIDTH));
  assert.ok(hitsDrawing('vertical', [{ x: 300, y: 40 }], { x: 303, y: 400 }, WIDTH));
  assert.ok(!hitsDrawing('vertical', [{ x: 300, y: 40 }], { x: 320, y: 40 }, WIDTH));
});

test('a channel is hit on either of its lines, not between them', () => {
  const channel = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }];
  assert.ok(hitsDrawing('channel', channel, { x: 50, y: 3 }, WIDTH));
  assert.ok(hitsDrawing('channel', channel, { x: 50, y: 38 }, WIDTH));
  assert.ok(!hitsDrawing('channel', channel, { x: 50, y: 20 }, WIDTH));
});

test('a retracement is hit on its levels, not in the space between them', () => {
  const fib = [{ x: 0, y: 0 }, { x: 100, y: 200 }];
  assert.ok(hitsDrawing('fib', fib, { x: 30, y: 100 }, WIDTH)); // the 0.5 level
  assert.ok(hitsDrawing('fib', fib, { x: 90, y: 200 * 0.618 }, WIDTH)); // the 0.618 level
  assert.ok(!hitsDrawing('fib', fib, { x: 10, y: 60 }, WIDTH)); // between levels
  assert.ok(!hitsDrawing('fib', fib, { x: 150, y: 100 }, WIDTH)); // beside it
});

test('a rectangle, a measure, a plan and a text note are hit anywhere inside their box', () => {
  const box = [{ x: 10, y: 10 }, { x: 110, y: 60 }];
  for (const tool of ['rectangle', 'measure', 'text'] as const) {
    assert.ok(hitsDrawing(tool, box, { x: 60, y: 35 }, WIDTH));
    assert.ok(!hitsDrawing(tool, box, { x: 60, y: 80 }, WIDTH));
  }
  const plan = [{ x: 0, y: 50 }, { x: 100, y: 0 }, { x: 100, y: 75 }];
  assert.ok(hitsDrawing('long', plan, { x: 50, y: 70 }, WIDTH));
  assert.ok(!hitsDrawing('long', plan, { x: 50, y: 90 }, WIDTH));
});

test('an ellipse is hit inside its curve, not in the corners of its box', () => {
  const ellipse = [{ x: 0, y: 0 }, { x: 200, y: 100 }];
  assert.ok(hitsDrawing('ellipse', ellipse, { x: 100, y: 50 }, WIDTH));
  assert.ok(hitsDrawing('ellipse', ellipse, { x: 190, y: 50 }, WIDTH));
  assert.ok(!hitsDrawing('ellipse', ellipse, { x: 190, y: 8 }, WIDTH));
});
