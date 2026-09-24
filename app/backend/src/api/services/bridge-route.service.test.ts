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
  for (const decimals of [19, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => convertExternalToStratoAmount(1n, decimals), /Unsupported external token decimals/);
  }
});

test("composite quotes reject missing and malformed indexed decimals", async (t) => {
  const service = await import("./bridge.service");
  const { getCompositeBridgeRouteQuote } = await import("./bridge-route.service");
  let externalDecimals: unknown;
  t.mock.method(service, "getBridgeableTokens", async () => [{ routeType: "standard", enabled: true,
    depositsEnabled: true, externalToken: "1".repeat(40), stratoToken: "2".repeat(40), externalDecimals }] as any);
  for (externalDecimals of [null, undefined, "", " ", "wat", "1.5", "0x12"]) {
    await assert.rejects(getCompositeBridgeRouteQuote("token", "1", "1".repeat(40), "2".repeat(40), "2".repeat(40), 1n), /Unsupported external token decimals/);
  }
});

test("requires DepositRouter 3.2 for routed ETH", () => {
  assert.equal(supportsAutoRouteRouter("3.1.0", true), false);
  assert.equal(supportsAutoRouteRouter("3.2.0", true), true);
  assert.equal(supportsAutoRouteRouter("3.0.0", false), true);
});

test("composite quotes reject zero slippage even for bridge-only deposits", async () => {
  const { getCompositeBridgeRouteQuote } = await import("./bridge-route.service");
  await assert.rejects(
    getCompositeBridgeRouteQuote("token", "1", "1".repeat(40), "2".repeat(40), "2".repeat(40), 100n, 0),
    /slippageBps must be an integer between 1 and 9999/
  );
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

test("native redemption quotes preserve base units and do not use ExternalAssetBridge routing", async (t) => {
  const service = await import("./bridge.service");
  const { cirrus } = await import("../../utils/appApiHelper");
  const { getCompositeBridgeRouteQuote } = await import("./bridge-route.service");
  const route = { id: "native", routeType: "native", enabled: true, externalBridge: "3".repeat(40),
    externalToken: "1".repeat(40), stratoToken: "2".repeat(40), externalDecimals: "18" };
  t.mock.method(service, "getBridgeableTokens", async () => [route] as any);
  t.mock.method(cirrus, "get", async () => { assert.fail("native redemptions must not query EAB rebase or router state"); });
  const quote = await getCompositeBridgeRouteQuote("token", "1", route.externalToken, route.stratoToken, route.stratoToken, 12345n);
  assert.equal(quote.bridge.routeType, "native");
  assert.equal(quote.bridge.externalBridge, route.externalBridge);
  assert.equal(quote.amountOut, "12345");
  assert.equal(quote.minFinalOut, "12345");
  assert.equal(quote.depositAction.action, 0);
  assert.deepEqual(quote.steps, []);
  for (const unavailable of [{ enabled: false }, { depositsPaused: true }, { depositsDisabled: true }, { externalBridge: "" }]) {
    t.mock.method(service, "getBridgeableTokens", async () => [{ ...route, ...unavailable }] as any);
    await assert.rejects(getCompositeBridgeRouteQuote("token", "1", route.externalToken, route.stratoToken, route.stratoToken, 12345n), /No enabled bridge route/);
  }
});


test("native deposits quote TokenRouter outputs only after both bridges support routing", async (t) => {
  const service = await import("./bridge.service");
  const routeService = await import("./route.service");
  const { cirrus } = await import("../../utils/appApiHelper");
  const { constants } = await import("../../config/constants");
  const { getCompositeBridgeRouteQuote } = await import("./bridge-route.service");
  const route = { id: "native", routeType: "native", enabled: true, externalBridge: "3".repeat(40),
    externalToken: "1".repeat(40), stratoToken: "2".repeat(40), externalDecimals: "18" };
  t.mock.method(service, "getBridgeableTokens", async () => [route] as any);
  let version = "1.2.0";
  let router: string | null | undefined = "5".repeat(40);
  let permission: unknown = true;
  t.mock.getter(constants, "tokenRouter", () => "5".repeat(40));
  t.mock.method(service, "getDepositRouterVersion", async (chain: string, bridge: string) => {
    assert.equal(chain, "1"); assert.equal(bridge, route.externalBridge); return version;
  });
  t.mock.method(cirrus, "get", async (_token: string, path: string, options: any) => {
    if (path === `/${constants.StratoNativeBridge}-autoRouteEnabled`) {
      assert.equal(options.params.address, `eq.${constants.stratoNativeBridge}`);
      assert.equal(options.params.key, `eq.${route.stratoToken}`);
      assert.equal(options.params.key2, "eq.1");
      return { data: permission === undefined ? [] : [{ value: permission }] } as any;
    }
    assert.equal(path, "/storage");
    assert.deepEqual(options.params, {
      address: `eq.${constants.stratoNativeBridge}`, select: "data->>tokenRouter", limit: "1",
    });
    return { data: router === undefined ? [] : [{ tokenRouter: router }] } as any;
  });
  t.mock.method(service, "isAutoRouteEnabled", async () => { assert.fail("must not use EAB action configs"); });
  t.mock.method(routeService, "getRouteQuote", async (_token: string, tokenIn: string, tokenOut: string, amount: bigint) => {
    assert.equal(tokenIn, route.stratoToken); assert.equal(amount, 12345n);
    return { tokenIn, tokenOut, amountIn: amount.toString(), amountOut: "24690", minFinalOut: "24566", steps: [{ action: 1 }] } as any;
  });
  const quote = await getCompositeBridgeRouteQuote("token", "1", route.externalToken, route.stratoToken, "4".repeat(40), 12345n);
  assert.equal(quote.depositAction.action, 4);
  assert.equal(quote.depositAction.actionToken, "4".repeat(40));
  assert.equal(quote.depositAction.minFinalOut, "24566");
  assert.equal(quote.bridge.bridgedAmount, "12345");
  for (permission of [false, undefined, "false", null, "1"]) {
    await assert.rejects(getCompositeBridgeRouteQuote("token", "1", route.externalToken, route.stratoToken, "4".repeat(40), 12345n), /routing is disabled/);
    const plain = await getCompositeBridgeRouteQuote("token", "1", route.externalToken, route.stratoToken, route.stratoToken, 12345n);
    assert.equal(plain.depositAction.action, 0);
  }
  permission = "true";
  for (const invalid of ["1.1.0", "", "invalid"]) {
    version = invalid;
    await assert.rejects(getCompositeBridgeRouteQuote("token", "1", route.externalToken, route.stratoToken, "4".repeat(40), 12345n), /not configured/);
  }
  version = "1.2.0";
  for (router of ["6".repeat(40), "0".repeat(40), "", null, undefined]) {
    await assert.rejects(getCompositeBridgeRouteQuote("token", "1", route.externalToken, route.stratoToken, "4".repeat(40), 12345n), /not configured/);
  }
});
