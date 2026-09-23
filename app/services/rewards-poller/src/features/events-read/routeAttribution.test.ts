import assert from "node:assert/strict";
import test from "node:test";
import { resolveRoutedActivityUser } from "./routeAttribution";

const route = {
  attributedUser: "0x1111111111111111111111111111111111111111",
  tokenRouter: "1111111111111111111111111111111111111111",
  externalAssetBridge: "2222222222222222222222222222222222222222",
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
