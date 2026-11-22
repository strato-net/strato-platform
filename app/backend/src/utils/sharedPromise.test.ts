import assert from "node:assert/strict";
import test, { TestContext } from "node:test";
import { createSharedPromiseCache, nodeCallWatch } from "./sharedPromise";

const TTL_MS = 5_000;
const MAX_LOAD_MS = 15_000;

const mockClock = (t: TestContext) =>
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 0, 1) });

// A load the test settles by hand.
const pendingLoads = () => {
  const settle: ((value: string) => void)[] = [];
  return { settle, load: () => new Promise<string>((resolve) => settle.push(resolve)) };
};

test("shares one load between concurrent callers and serves it for the TTL", async (t) => {
  mockClock(t);
  const shared = createSharedPromiseCache(TTL_MS, MAX_LOAD_MS);
  let loads = 0;
  const load = async () => ++loads;

  assert.deepEqual(await Promise.all([shared("key", load), shared("key", load)]), [1, 1]);
  t.mock.timers.tick(TTL_MS - 1);
  assert.equal(await shared("key", load), 1);
  t.mock.timers.tick(1);
  assert.equal(await shared("key", load), 2);
});

test("does not keep a load that rejects and warns once a minute", async (t) => {
  mockClock(t);
  const warn = t.mock.method(console, "warn", () => {});
  const shared = createSharedPromiseCache(TTL_MS, MAX_LOAD_MS);
  let loads = 0;
  const load = async () => {
    loads++;
    throw new Error("node down");
  };

  const results = await Promise.allSettled([shared("key", load), shared("key", load)]);
  assert.deepEqual(results.map((result) => result.status), ["rejected", "rejected"]);
  assert.equal(loads, 1);

  t.mock.timers.tick(59_999);
  await assert.rejects(shared("key", load), /node down/);
  assert.equal(loads, 2);
  assert.deepEqual(warn.mock.calls.map((call) => call.arguments), [
    ["Shared state key not cached: load failed: node down"],
  ]);
});

test("does not keep a load during which a node call failed", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const shared = createSharedPromiseCache(TTL_MS, MAX_LOAD_MS);
  let loads = 0;
  const load = async () => {
    loads++;
    nodeCallWatch.getStore()!.failedCall = "/BlockApps-Pool 503";
    return "degraded";
  };

  assert.deepEqual(await Promise.all([shared("key", load), shared("key", load)]), ["degraded", "degraded"]);
  assert.equal(await shared("key", load), "degraded");
  assert.equal(loads, 2);
  assert.deepEqual(warn.mock.calls.map((call) => call.arguments), [
    ["Shared state key not cached: node call failed: /BlockApps-Pool 503"],
  ]);
});

test("marks a watched caller with the failed call of the load it starts or joins, not after a clean load", async (t) => {
  t.mock.method(console, "warn", () => {});
  const shared = createSharedPromiseCache(TTL_MS, MAX_LOAD_MS);
  const failing = async () => {
    await Promise.resolve();
    nodeCallWatch.getStore()!.failedCall = "/BlockApps-Pool 503";
    return "degraded";
  };
  const starter: { failedCall?: string } = {};
  const joiner: { failedCall?: string } = {};
  const clean: { failedCall?: string } = {};

  const started = nodeCallWatch.run(starter, () => shared("key", failing));
  const joined = nodeCallWatch.run(joiner, () => shared("key", failing));
  assert.equal(joined, started);
  assert.equal(await started, "degraded");
  assert.deepEqual([starter.failedCall, joiner.failedCall], ["/BlockApps-Pool 503", "/BlockApps-Pool 503"]);

  assert.equal(await nodeCallWatch.run(clean, () => shared("clean", async () => "fine")), "fine");
  assert.equal(clean.failedCall, undefined);
});

test("bypasses a load after maxLoadMs; its late result does not replace a newer one", async (t) => {
  mockClock(t);
  const shared = createSharedPromiseCache(TTL_MS, MAX_LOAD_MS);
  const { settle, load } = pendingLoads();

  const stuck = shared("key", load);
  t.mock.timers.tick(MAX_LOAD_MS - 1);
  assert.equal(shared("key", load), stuck);
  t.mock.timers.tick(1);
  const newer = shared("key", load);
  assert.notEqual(newer, stuck);

  settle[1]("newer");
  assert.equal(await newer, "newer");
  settle[0]("stuck");
  assert.equal(await stuck, "stuck");
  assert.equal(await shared("key", load), "newer");
  assert.equal(settle.length, 2);
});

test("keeps a bypassed load's result when it arrives before the newer one", async (t) => {
  mockClock(t);
  const shared = createSharedPromiseCache(TTL_MS, MAX_LOAD_MS);
  const { settle, load } = pendingLoads();

  const stuck = shared("key", load);
  t.mock.timers.tick(MAX_LOAD_MS);
  shared("key", load);

  settle[0]("stuck");
  assert.equal(await stuck, "stuck");
  assert.equal(await shared("key", load), "stuck");
  assert.equal(settle.length, 2);
});

test("turns a load that throws synchronously into a rejection", async (t) => {
  t.mock.method(console, "warn", () => {});
  const shared = createSharedPromiseCache(TTL_MS, MAX_LOAD_MS);

  await assert.rejects(
    shared("key", () => {
      throw new Error("not configured");
    }),
    /not configured/
  );
});
