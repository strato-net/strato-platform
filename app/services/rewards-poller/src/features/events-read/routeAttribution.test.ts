import assert from "node:assert/strict";
import test from "node:test";
import { shouldSkipRouteReward } from "./routeAttribution";

const route = {
  eventAddress: "0x1111111111111111111111111111111111111111",
  eventName: "RouteExecuted",
  tokenRouter: "1111111111111111111111111111111111111111",
  externalAssetBridge: "2222222222222222222222222222222222222222",
};

test("rewards a direct TokenRouter caller", () => {
  assert.equal(
    shouldSkipRouteReward({
      ...route,
      caller: "3333333333333333333333333333333333333333",
    }),
    false
  );
});

test("skips ExternalAssetBridge routes to avoid duplicate rewards", () => {
  assert.equal(
    shouldSkipRouteReward({
      ...route,
      caller: "0x2222222222222222222222222222222222222222",
    }),
    true
  );
});

test("fails closed when the bridge address is unavailable", () => {
  assert.equal(
    shouldSkipRouteReward({
      ...route,
      caller: "3333333333333333333333333333333333333333",
      externalAssetBridge: undefined,
    }),
    true
  );
});
