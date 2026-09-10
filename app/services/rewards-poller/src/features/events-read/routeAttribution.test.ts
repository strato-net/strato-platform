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

test("fails closed when the bridge address is unavailable", () => {
  assert.equal(
    resolveRoutedActivityUser({
      ...route,
      routedCaller: "3333333333333333333333333333333333333333",
      externalAssetBridge: undefined,
    }),
    null
  );
});
