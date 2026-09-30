import assert from "node:assert/strict";
import test from "node:test";
import { resolveRoutedActivityUser, indexRouteExecutions, getRoutedActivityCaller } from "./routeAttribution";

const route = {
  attributedUser: "0x1111111111111111111111111111111111111111",
  tokenRouter: "1111111111111111111111111111111111111111",
  externalAssetBridge: "2222222222222222222222222222222222222222",
  nativeBridge: "4".repeat(40),
};

test("attributes underlying route activity to a direct caller", () => {
  assert.equal(
    resolveRoutedActivityUser({
      ...route,
      routedCaller: "3333333333333333333333333333333333333333",
    }),
    "3333333333333333333333333333333333333333"
  );
});

test("skips ExternalAssetBridge routes to avoid duplicate rewards", () => {
  assert.equal(
    resolveRoutedActivityUser({
      ...route,
      routedCaller: "0x2222222222222222222222222222222222222222",
    }),
    null
  );
});

test("fails closed when the bridge address is missing, zero, or malformed", () => {
  for (const externalAssetBridge of [
    undefined, "", " ", "0".repeat(40), `0x${"0".repeat(40)}`, `0X${"0".repeat(40)}`,
    "2".repeat(39), "2".repeat(41), "g".repeat(40), ` ${route.externalAssetBridge}`,
  ]) {
    for (const routedCaller of [route.externalAssetBridge, "3".repeat(40)]) {
      assert.equal(resolveRoutedActivityUser({ ...route, routedCaller, externalAssetBridge }), null);
    }
  }
});

test("recognizes nonzero bridge addresses with mixed case and optional prefixes", () => {
  const bridge = "abcdef".repeat(6) + "abcd";
  for (const externalAssetBridge of [bridge, `0x${bridge.toUpperCase()}`, `0X${bridge}`]) {
    assert.equal(resolveRoutedActivityUser({ ...route, externalAssetBridge, routedCaller: bridge }), null);
    assert.equal(resolveRoutedActivityUser({ ...route, externalAssetBridge, routedCaller: "3".repeat(40) }), "3".repeat(40));
  }
});

test("keeps non-routed activity attribution when bridge configuration is invalid", () => {
  assert.equal(
    resolveRoutedActivityUser({
      ...route,
      attributedUser: "3".repeat(40),
      externalAssetBridge: "0".repeat(40),
    }),
    "3".repeat(40)
  );
});

test("fails closed when the routed caller is unavailable", () => {
  assert.equal(resolveRoutedActivityUser(route), null);
});


test("skips native bridge routes rather than rewarding the bridge contract", () => {
  assert.equal(resolveRoutedActivityUser({ ...route, nativeBridge: "4".repeat(40), routedCaller: `0x${"4".repeat(40)}` }), null);
  assert.equal(resolveRoutedActivityUser({ ...route, nativeBridge: "4".repeat(40), routedCaller: "3".repeat(40) }), "3".repeat(40));
});


test("fails closed for routed rewards until native bridge attribution is configured", () => {
  for (const nativeBridge of [undefined, "", "0".repeat(40), "malformed"]) {
    assert.equal(resolveRoutedActivityUser({ ...route, nativeBridge, routedCaller: "4".repeat(40) }), null);
  }
});


const transactionHash = "a".repeat(64);
const execution = (event_index: number, caller?: string) => ({ transaction_hash: transactionHash, event_index, attributes: { caller } });

test("multiple routes use the next completion boundary, independent of query order", () => {
  const first = "5".repeat(40), last = "6".repeat(40);
  const routes = indexRouteExecutions([execution(12, last), execution(3, first), execution(8, route.externalAssetBridge)]);
  for (const [index, expected] of [[0, first], [2, first], [4, route.externalAssetBridge], [7, route.externalAssetBridge], [9, last], [11, last]] as const) {
    const caller = getRoutedActivityCaller(routes, `0x${transactionHash.toUpperCase()}`, index);
    assert.equal(caller, expected);
    assert.equal(resolveRoutedActivityUser({ ...route, routedCaller: caller }), expected === route.externalAssetBridge ? null : expected);
  }
  assert.equal(getRoutedActivityCaller(routes, transactionHash, 13), undefined);
  assert.equal(getRoutedActivityCaller(routes, "b".repeat(64), 1), undefined);
  assert.equal(getRoutedActivityCaller(routes, transactionHash, NaN), undefined);
});

test("same-caller routes work and malformed callers never bleed into the next route", () => {
  const caller = "7".repeat(40);
  const routes = indexRouteExecutions([execution(3, caller), execution(8), execution(12, caller)]);
  assert.equal(getRoutedActivityCaller(routes, transactionHash, 1), caller);
  assert.equal(getRoutedActivityCaller(routes, transactionHash, 6), undefined);
  assert.equal(getRoutedActivityCaller(routes, transactionHash, 10), caller);
  for (const index of [NaN, -1, Number.MAX_SAFE_INTEGER + 1, null, ""]) {
    assert.throws(() => indexRouteExecutions([execution(index as number, caller)]), /Invalid/);
  }
  assert.throws(() => indexRouteExecutions([execution(3, caller), execution(3, caller)]), /Duplicate/);
});

test("event ingestion attributes batched routes independently and fully paginates their boundaries", async t => {
  for (const name of ["BA_USERNAME", "BA_PASSWORD", "CLIENT_SECRET", "CLIENT_ID", "OPENID_DISCOVERY_URL", "REWARDS_CONTRACT_ADDRESS", "TOKEN_ROUTER", "PRICE_ORACLE_ADDRESS", "NODE_URL"]) process.env[name] ||= "test";
  const { config } = await import("../../infra/config/runtimeConfig");
  const { cirrus } = await import("../../infra/http/api");
  const mapper = await import("./activity.mapper");
  const { getEventsBatch } = await import("./cirrusEvents.client");
  const { makeEventPairKey } = await import("./actionableEvents.parser");
  const previous = [config.tokenRouter.address, config.externalAssetBridge.address, config.nativeBridge.address];
  config.tokenRouter.address = route.tokenRouter;
  config.externalAssetBridge.address = route.externalAssetBridge;
  config.nativeBridge.address = route.nativeBridge;
  t.after(() => { [config.tokenRouter.address, config.externalAssetBridge.address, config.nativeBridge.address] = previous; });
  const pool = "9".repeat(40), alice = "5".repeat(40), bob = "6".repeat(40);
  t.mock.method(mapper, "loadAttributeMapping", () => ({ [pool]: { Deposit: { amount: "shares", user: "sender" } } }));
  const hashes = Array.from({ length: 22 }, (_, i) => i.toString(16).padStart(64, "a"));
  const activities = hashes.flatMap((hash, i) => [1, 4, 7].map(event_index => ({ address: pool, event_name: "Deposit", attributes: { sender: route.tokenRouter, shares: "100" },
    event_index, transaction_hash: hash, transaction_sender: alice, block_number: String(100 + i), block_timestamp: "2026-01-01T00:00:00Z" })));
  const completions = hashes.flatMap((hash, i) => [alice, i % 2 ? route.nativeBridge : route.externalAssetBridge, bob].map((caller, index) => ({ transaction_hash: hash, event_index: 2 + 3 * index, attributes: { caller } })));
  activities.push({ ...activities[0], event_index: 10 }); // No following route: do not reuse the last caller.
  activities.push({ ...activities[0], event_index: 11, attributes: { sender: alice, shares: "100" } });
  let unavailable = false;
  const calls: any[] = [];
  t.mock.method(cirrus, "get", async (_path: string, options: any) => {
    const params = options.params;
    if (params.event_name !== "eq.RouteExecuted") return activities;
    calls.push(params);
    assert.equal(params.address, `eq.${route.tokenRouter}`);
    assert.match(params.select, /event_index/);
    assert.equal(params.order, "id.asc");
    assert.ok(params.limit <= 200);
    assert.equal(params.block_timestamp, undefined, "fetch whole transactions even across a cursor boundary");
    const ids = params.transaction_hash.startsWith("eq.") ? [params.transaction_hash.slice(3)] : params.transaction_hash.slice(4, -1).split(",");
    assert.ok(ids.length <= 20);
    if (unavailable && params.offset > 0) throw new Error("Route lookup unavailable");
    return completions.filter(row => ids.includes(row.transaction_hash)).slice(params.offset, params.offset + 1);
  });
  const cursor = { blockNumber: 0, eventIndex: -1, block_timestamp: "2026-01-01T00:00:00Z" };
  const read = () => getEventsBatch([pool], ["Deposit"], cursor, new Set([makeEventPairKey(pool, "Deposit")]), new Map(), []);
  let events = await read();
  assert.equal(events.length, 45);
  assert.equal(events.filter(event => event.transaction_sender === bob).length, 22);
  assert.equal(events.filter(event => event.transaction_sender === alice).length, 23);
  assert.ok(events.every(event => event.event_index !== 4 && event.event_index !== 10));
  assert.equal(calls.filter(params => params.offset === 0).length, 2, "transaction hashes use bounded batches");
  cursor.blockNumber = 100; cursor.eventIndex = 3;
  events = await read();
  assert.equal(events.length, 44);
  assert.equal(events.find(event => event.block_number === 100)?.transaction_sender, bob);
  unavailable = true;
  await assert.rejects(read(), /Route lookup unavailable/, "incomplete boundary reads must not produce partial rewards");
});
