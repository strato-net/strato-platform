import assert from "node:assert/strict";
import test from "node:test";
import { collectNativeRedemptionChainIds } from "./nativeRedemptionChains";

test("polls a native-only chain that has no deposit router", () => {
  const nativeRouteChains = [1, 56];
  const depositChains = [1, 8453];

  assert.deepEqual(
    collectNativeRedemptionChainIds(nativeRouteChains, depositChains),
    [1, 56, 8453],
  );
});

test("keeps deposit chains when no native routes are enabled", () => {
  assert.deepEqual(collectNativeRedemptionChainIds([], [4663, 1]), [1, 4663]);
});

test("drops invalid chain ids and accepts numeric strings", () => {
  assert.deepEqual(
    collectNativeRedemptionChainIds(
      ["196", 0, -1, Number.NaN, null, undefined, "abc"],
      [2 ** 53, 196],
    ),
    [196],
  );
});
