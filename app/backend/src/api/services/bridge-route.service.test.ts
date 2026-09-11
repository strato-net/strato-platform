import assert from "node:assert/strict";
import test from "node:test";
import {
  convertExternalToStratoAmount,
  supportsAutoRouteRouter,
} from "./bridge-route.service";

test("converts six-decimal external amounts to STRATO decimals", () => {
  assert.equal(
    convertExternalToStratoAmount(1_000_000_000n, 6),
    1_000n * 10n ** 18n
  );
});

test("applies a rebase factor after decimal conversion", () => {
  assert.equal(
    convertExternalToStratoAmount(
      2_000_000n,
      6,
      (2n * 10n ** 18n).toString()
    ),
    1n * 10n ** 18n
  );
});

test("rejects unsupported external decimals", () => {
  assert.throws(
    () => convertExternalToStratoAmount(1n, 19),
    /Unsupported external token decimals/
  );
});

test("requires DepositRouter 3.2 for routed ETH", () => {
  assert.equal(supportsAutoRouteRouter("3.1.0", true), false);
  assert.equal(supportsAutoRouteRouter("3.2.0", true), true);
  assert.equal(supportsAutoRouteRouter("3.0.0", false), true);
});


test("composite quotes reject withdrawal-only routes", async (t) => {
  const service = await import("./bridge.service");
  const { getCompositeBridgeRouteQuote } = await import("./bridge-route.service");
  t.mock.method(service, "getBridgeableTokens", async () => [{ routeType: "standard", enabled: true,
    depositsEnabled: false, externalToken: "1".repeat(40), stratoToken: "2".repeat(40) }] as any);
  await assert.rejects(getCompositeBridgeRouteQuote("token", "1", "1".repeat(40), "2".repeat(40), "2".repeat(40), 1n), /No enabled bridge route/);
});

test("preserves fractional external base units when rebasing", () => {
  assert.equal(convertExternalToStratoAmount(1n, 6, "1500000000000000000"), 666666666666n);
  assert.equal(convertExternalToStratoAmount(1n, 0, "1500000000000000000"), 666666666666666666n);
});
