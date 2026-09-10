import assert from "node:assert/strict";
import test from "node:test";
import { RouteAction, type RouteStepQuote } from "@strato/shared-types";
import {
  applyRouteSlippage,
  findRoutePaths,
  toExecutableRouteStep,
} from "./route.service";

const swap = (tokenIn: string, tokenOut: string) => ({
  kind: "SWAP" as const,
  tokenIn,
  tokenOut,
});

test("applies route slippage in basis points", () => {
  assert.equal(applyRouteSlippage(1_000_000n, 50), 995_000n);
  assert.equal(applyRouteSlippage(1_000_000n, 0), 1_000_000n);
  assert.throws(() => applyRouteSlippage(1n, 10_000), /slippageBps/);
});

test("finds direct routes before longer alternatives", () => {
  const routes = findRoutePaths(
    [swap("a", "c"), swap("c", "b"), swap("a", "b")],
    "a",
    "b"
  );
  assert.equal(routes[0].length, 1);
});

test("does not revisit tokens or exceed six steps", () => {
  const edges = [
    swap("a", "b"),
    swap("b", "a"),
    swap("b", "c"),
    swap("c", "d"),
    swap("d", "e"),
    swap("e", "f"),
    swap("f", "g"),
    swap("g", "h"),
  ];
  assert.equal(findRoutePaths(edges, "a", "g")[0].length, 6);
  assert.deepEqual(findRoutePaths(edges, "a", "h"), []);
});

test("removes quote-only fields from executable route steps", () => {
  const quotedStep: RouteStepQuote = {
    action: RouteAction.SWAP_STABLE,
    target: "pool",
    tokenIn: "a",
    tokenOut: "b",
    minAmountOut: "90",
    parameter1: "0",
    parameter2: "2",
    direction: false,
    factoryPoolIndex: "7",
    amountIn: "100",
    amountOut: "95",
    feeAmount: "1",
    feeBps: 10,
    priceImpact: 0.1,
    label: "Stable",
  };
  assert.deepEqual(toExecutableRouteStep(quotedStep), {
    action: RouteAction.SWAP_STABLE,
    target: "pool",
    tokenIn: "a",
    tokenOut: "b",
    minAmountOut: "90",
    parameter1: "0",
    parameter2: "2",
    direction: false,
    factoryPoolIndex: "7",
  });
});

test("reuses swap topology and request-local quotes without reusing live outputs", async (t) => {
  const { cirrus } = await import("../../utils/appApiHelper");
  const { constants, ROUTE_TOPOLOGY_TTL_MS } = await import("../../config/constants");
  const config = await import("../../config/config");
  const trade = await import("./trade.service");
  const swapping = await import("../helpers/swapping.helper");
  const psm = await import("./psm.service");
  const forge = await import("./metalForge.service");
  const save = await import("./saveUsdst.service");
  const { getRouteQuote } = await import("./route.service");
  let now = 1000;
  let discoveryCalls = 0;
  let failDiscovery = false;
  let failQuote = false;
  let multiplier = 2n;
  const calls: string[] = [];
  const pairs = [["a", "b"], ["a", "c"], ["b", "d"], ["b", "c"], ["c", "d"]];
  t.mock.method(Date, "now", () => now);
  t.mock.method(swapping, "fetchMultiTokenStablePools", async () => []);
  t.mock.method(psm, "getPsmMintState", async () => ({ mintPaused: true }));
  t.mock.method(forge, "getConfigs", async () => ({ metals: [], payTokens: [] }));
  t.mock.method(save, "getSaveUsdstActionState", async () => null);
  t.mock.method(cirrus, "get", async (_token: string, path: string) => {
    if (path === `/${constants.Pool}`) {
      discoveryCalls++;
      if (failDiscovery) throw new Error("discovery unavailable");
      return { data: pairs.map(([a, b]) => ({
        address: a + b, tokenA: { address: a, status: "2" },
        tokenB: { address: b, status: "2" }, tokenABalance: "100", tokenBBalance: "100",
        isPaused: false, isDisabled: false,
      })) };
    }
    if (path === `/${constants.Token}`) {
      return { data: ["a", "b", "c", "d"].map((address) => ({ address, status: "2" })) };
    }
    return { data: [] };
  });
  t.mock.method(swapping, "fetchPoolTokenAddresses", async (_token: string, pool: string) => ({
    tokenA: pool[0], tokenB: pool[1],
  }));
  t.mock.method(trade, "getTradeQuotes", async (_token: string, tokenIn: string, tokenOut: string, amount: bigint) => {
    calls.push(`${tokenIn}:${tokenOut}:${amount}`);
    if (failQuote) throw new Error("pool paused");
    return {
      bestPoolAddress: tokenIn + tokenOut,
      quotes: [{ poolAddress: tokenIn + tokenOut, poolType: "v2", tokenIn, tokenOut,
        amountIn: String(amount), amountOut: String(amount * multiplier),
        feeAmount: "0", feeBps: 0, priceImpact: 0, poolLabel: "test" }],
    };
  });

  const quote = () => getRouteQuote("token", "a", "d", 100n);
  const first = await Promise.all([quote(), quote()]);
  assert.equal(discoveryCalls, 1, "concurrent requests share discovery");
  assert.equal(first[0].amountOut, "800");
  assert.equal(calls.filter((key) => key === "a:b:100").length, 2, "shared prefix quoted once per request");
  assert.ok(calls.includes("c:d:200"));
  assert.ok(calls.includes("c:d:400"), "same edge with different amounts is quoted separately");
  multiplier = 3n;
  calls.length = 0;
  assert.equal((await quote()).amountOut, "2700", "new requests use fresh amounts");
  assert.equal(discoveryCalls, 1);
  assert.equal(calls.filter((key) => key === "a:b:100").length, 1);
  assert.ok(calls.includes("c:d:900"), "different input amounts get different quotes");
  failQuote = true;
  await assert.rejects(quote(), /No executable route/, "cached topology does not bypass live quote failure");
  failQuote = false;
  assert.equal((await quote()).amountOut, "2700", "failed quotes do not persist across requests");

  now += ROUTE_TOPOLOGY_TTL_MS;
  failDiscovery = true;
  await assert.rejects(quote(), /discovery unavailable/);
  failDiscovery = false;
  await quote();
  assert.equal(discoveryCalls, 3, "expired topology refreshes and failed discovery is not cached");
  const originalNetwork = config.networkId;
  t.after(() => { (config as any).networkId = originalNetwork; });
  (config as any).networkId = "different-network";
  await quote();
  assert.equal(discoveryCalls, 4, "network changes invalidate topology");
});

test("vault previews use full precision and reject deposits execution would reject", async () => {
  const { previewVaultDeposit } = await import("../helpers/vault.helper");
  const { MAX_UINT256 } = await import("../../config/constants");
  const assets = 2n * 10n ** 18n + 2n;
  const supply = 3n * 10n ** 18n;
  const amount = 100n * 10n ** 18n;
  const state = { pricingAssets: String(assets), totalShares: String(supply), maxDeposit: String(MAX_UINT256) };
  const expected = amount * supply / assets;
  assert.equal(previewVaultDeposit(amount, state), expected);
  assert.ok(amount * 10n ** 18n / (assets * 10n ** 18n / supply) > expected, "rounded rates overstate shares");
  assert.equal(previewVaultDeposit(100n, { ...state, totalShares: "0" }), 100n);
  assert.throws(() => previewVaultDeposit(100n, { ...state, maxDeposit: "99" }), /limits/);
  assert.throws(() => previewVaultDeposit(1n, { ...state, maxDeposit: "0" }), /limits/);
  assert.throws(() => previewVaultDeposit(1n, { ...state, pricingAssets: "0" }), /insolvent/);
  assert.throws(() => previewVaultDeposit(1n, { ...state, totalShares: "1" }), /zero shares/);
  assert.throws(() => previewVaultDeposit(MAX_UINT256, state), /overflows/);
});

test("both vault routes quote from accounting totals and respect deposit availability", async (t) => {
  const config = await import("../../config/config");
  const { constants, MAX_UINT256 } = await import("../../config/constants");
  const { cirrus } = await import("../../utils/appApiHelper");
  const swapping = await import("../helpers/swapping.helper");
  const save = await import("./saveUsdst.service");
  const yieldVault = await import("./yieldVault.service");
  const psm = await import("./psm.service");
  const forge = await import("./metalForge.service");
  const { getRouteQuote } = await import("./route.service");
  const originalSave = config.saveUsdstVault;
  const originalRouter = config.tokenRouter;
  (config as any).saveUsdstVault = "save";
  (config as any).tokenRouter = "router";
  t.after(() => { (config as any).saveUsdstVault = originalSave; (config as any).tokenRouter = originalRouter; });
  t.mock.method(swapping, "fetchMultiTokenStablePools", async () => []);
  t.mock.method(psm, "getPsmMintState", async () => ({ mintPaused: true }));
  t.mock.method(forge, "getConfigs", async () => ({ metals: [], payTokens: [] }));
  t.mock.method(cirrus, "get", async (_token: string, path: string) => ({ data:
    path === `/${constants.TokenRouter}-approvedYieldVaults` ? [{ key: "yield" }] : [] }));
  const totals = { totalShares: "3000000000000000000", pricingAssets: "2000000000000000002" };
  let paused = false;
  let deployed = true;
  let maximum = String(MAX_UINT256);
  t.mock.method(save, "getSaveUsdstActionState", async () => deployed ? ({
    ...totals, maxDeposit: maximum, vaultAddress: "save", assetAddress: "asset", shareSymbol: "SAVE", paused,
    projectedExchangeRate: "1",
  }) : null);
  t.mock.method(yieldVault, "listVaultDefs", () => [{ key: "yield", address: "yield" }] as any);
  t.mock.method(yieldVault, "getYieldVaultInfo", async () => ({
    totalShares: totals.totalShares, projectedActiveAssets: totals.pricingAssets,
    vaultAddress: "yield", assetAddress: "asset", shareSymbol: "YIELD", decimals: 18,
    deployed, paused, projectedExchangeRate: "1",
  }) as any);
  for (const target of ["save", "yield"]) {
    const quote = await getRouteQuote("token", "asset", target, 100000000000000000000n);
    assert.equal(quote.amountOut, String(100000000000000000000n * BigInt(totals.totalShares) / BigInt(totals.pricingAssets)));
    assert.equal(quote.steps[0].target, target);
  }
  paused = true;
  for (const target of ["save", "yield"]) await assert.rejects(getRouteQuote("token", "asset", target, 100n), /No route/);
  paused = false;
  deployed = false;
  for (const target of ["save", "yield"]) await assert.rejects(getRouteQuote("token", "asset", target, 100n), /No route/);
  deployed = true;
  maximum = "99";
  await assert.rejects(getRouteQuote("token", "asset", "save", 100n), /No executable route/);
  maximum = String(MAX_UINT256);
  totals.pricingAssets = "0";
  for (const target of ["save", "yield"]) await assert.rejects(getRouteQuote("token", "asset", target, 100n), /No executable route/);
});

test("Save USDST deposit state checks initialization and invalid empty-supply accounting", async (t) => {
  const config = await import("../../config/config");
  const { constants } = await import("../../config/constants");
  const { cirrus } = await import("../../utils/appApiHelper");
  const oracle = await import("./oracle.service");
  const { getSaveUsdstActionState } = await import("./saveUsdst.service");
  const original = config.saveUsdstVault;
  (config as any).saveUsdstVault = "save";
  t.after(() => { (config as any).saveUsdstVault = original; });
  const state = { address: "save", assetToken: "asset", vaultInitialized: "false",
    _managedAssets: "2", _totalSupply: "3", _paused: "false", _symbol: "SAVE" };
  t.mock.method(oracle, "getOraclePrices", async () => new Map());
  t.mock.method(cirrus, "get", async (_token: string, path: string, options: any) => {
    if (path === `/${constants.SaveUSDSTVault}`) {
      assert.ok(options.params.select.includes("vaultInitialized"));
      return { data: [state] };
    }
    if (path === `/${constants.Token}-_balances`) return { data: [{ value: "2" }] };
    return { data: [] };
  });
  assert.equal(await getSaveUsdstActionState("token"), null);
  state.vaultInitialized = "true";
  const available = await getSaveUsdstActionState("token");
  assert.equal(available?.pricingAssets, "2");
  assert.equal(available?.totalShares, "3");
  assert.ok(BigInt(available!.maxDeposit) > 0n);
  state._paused = "true";
  assert.equal((await getSaveUsdstActionState("token"))?.maxDeposit, "0");
  state._paused = "false";
  state._totalSupply = "0";
  assert.equal((await getSaveUsdstActionState("token"))?.maxDeposit, "0");
  state._managedAssets = "0";
  assert.ok(BigInt((await getSaveUsdstActionState("token"))!.maxDeposit) > 0n);
});
