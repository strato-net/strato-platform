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
  assert.equal(applyRouteSlippage(1_000_000n, 1), 999_900n);
  for (const invalid of [0, -1, 0.5, 10_000, NaN]) {
    assert.throws(() => applyRouteSlippage(1n, invalid), /slippageBps/);
  }
});

test("route API validation requires at least one basis point of slippage", async () => {
  const { validateRouteQuoteArgs, validateCompositeRouteQuoteArgs, validateRouteExecuteArgs } =
    await import("../validators/trade.validator");
  const tokens = { tokenIn: "1".repeat(40), tokenOut: "2".repeat(40) };
  const cases: Array<[(args: any) => void, object]> = [
    [validateRouteQuoteArgs, { ...tokens, amount: "100" }],
    [validateRouteExecuteArgs, { ...tokens, amountIn: "100", minFinalOut: "99" }],
    [validateCompositeRouteQuoteArgs, { externalChainId: "1", externalToken: tokens.tokenIn,
      targetStratoToken: "3".repeat(40), tokenOut: tokens.tokenOut, amount: "100" }],
  ];
  for (const [validate, args] of cases) {
    for (const slippageBps of [0, -1, 0.5, 10000]) {
      assert.throws(() => validate({ ...args, slippageBps }), /slippageBps/);
    }
    for (const slippageBps of [undefined, 1, 50, 9999]) {
      assert.doesNotThrow(() => validate({ ...args, slippageBps }));
    }
  }
  const { getRouteQuote } = await import("./route.service");
  await assert.rejects(getRouteQuote("token", tokens.tokenIn, tokens.tokenOut, 100n, 0), /slippageBps/);
});

test("finds direct routes before longer alternatives", () => {
  const routes = findRoutePaths(
    [swap("a", "c"), swap("c", "b"), swap("a", "b")],
    "a",
    "b"
  );
  assert.equal(routes[0].length, 1);
});

test("factory pool index lookup uses JSON address values and preserves index zero", async (t) => {
  const { fetchFactoryPoolIndex } = await import("./route.service");
  const { cirrus } = await import("../../utils/appApiHelper");
  const { constants } = await import("../../config/constants");
  const pool = "ab".repeat(20);
  let rows: Array<{ key: number; value: string }> = [{ key: 0, value: pool }];
  t.mock.method(cirrus, "get", async (_token: string, path: string, options: any) => {
    assert.equal(path, `/${constants.PoolFactory}-allPools`);
    assert.equal(options.params.address, `eq.${constants.poolFactory}`);
    assert.equal(options.params.value, `eq."${pool}"`);
    return { data: rows };
  });
  assert.equal(await fetchFactoryPoolIndex("token", `0x${pool.toUpperCase()}`), "0");
  rows = [{ key: 10, value: pool }];
  assert.equal(await fetchFactoryPoolIndex("token", pool), "10");
  rows = [];
  await assert.rejects(fetchFactoryPoolIndex("token", pool), /Pool factory index could not be resolved/);
});

test("pool deep links resolve token addresses across pool types without loading analytics", async (t) => {
  const { getRoutePoolTokens } = await import("./route.service");
  const swapping = await import("../helpers/swapping.helper");
  const v3 = await import("./poolV3.service");
  const config = await import("../../config/config");
  const pool = "a".repeat(40);
  let kind = "stable";
  t.mock.method(swapping, "fetchPoolCoins", async (_token: string, address: string) => {
    assert.equal(address, pool);
    return kind === "stable" ? ["1", "2", "3"].map((digit, coinIndex) => ({ coinIndex, tokenAddress: digit.repeat(40) })) : [];
  });
  t.mock.method(swapping, "fetchPoolTokenAddresses", async () => kind === "v2" ? { tokenA: "1".repeat(40), tokenB: "2".repeat(40) } : undefined);
  t.mock.method(v3, "getPoolTokenPairs", async () => new Map(kind === "v3" ? [[pool, { token0: "2".repeat(40), token1: "3".repeat(40) }]] : []));
  assert.deepEqual(await getRoutePoolTokens("token", `0x${pool.toUpperCase()}`), ["1".repeat(40), "2".repeat(40), "3".repeat(40)]);
  kind = "v2";
  assert.deepEqual(await getRoutePoolTokens("token", pool), ["1".repeat(40), "2".repeat(40)]);
  kind = "v3";
  assert.deepEqual(await getRoutePoolTokens("token", pool), ["2".repeat(40), "3".repeat(40)]);
  config.hiddenSwapPools.add(pool);
  t.after(() => config.hiddenSwapPools.delete(pool));
  assert.deepEqual(await getRoutePoolTokens("token", pool), []);
  config.hiddenSwapPools.delete(pool);
  kind = "missing";
  assert.deepEqual(await getRoutePoolTokens("token", pool), []);
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
    action: "SWAP_STABLE",
    target: "pool",
    tokenIn: "a",
    tokenOut: "b",
    minAmountOut: "90",
    parameter1: "0",
    parameter2: "2",
    direction: false,
    factoryPoolIndex: "7",
  });
  for (const [action, name] of [
    [RouteAction.SWAP_V2, "SWAP_V2"],
    [RouteAction.SWAP_STABLE, "SWAP_STABLE"],
    [RouteAction.SWAP_V3, "SWAP_V3"],
    [RouteAction.PSM_MINT, "PSM_MINT"],
    [RouteAction.FORGE, "FORGE"],
    [RouteAction.SAVE, "SAVE"],
    [RouteAction.YIELD_VAULT_DEPOSIT, "YIELD_VAULT_DEPOSIT"],
  ] as const) {
    assert.equal(toExecutableRouteStep({ ...quotedStep, action }).action, name);
  }
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
    if (path === `/${constants.PoolFactory}-allPools`) return { data: [{ key: 10 }] };
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
  assert.equal(first[0].steps.length, 3, "materially better output justifies extra steps");
  assert.ok(first[0].steps.every(step => step.factoryPoolIndex === "10"), "V2 steps carry their registry index");
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
  await assert.rejects(quote(), { name: "StratoError", status: 422, message: /No executable route/ }, "cached topology does not bypass live quote failure");
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

test("selects the shortest route within the output tolerance of the global best", async (t) => {
  const { cirrus } = await import("../../utils/appApiHelper");
  const settings = await import("../../config/constants");
  const { constants } = settings;
  const config = await import("../../config/config");
  const trade = await import("./trade.service");
  const swapping = await import("../helpers/swapping.helper");
  const psm = await import("./psm.service");
  const forge = await import("./metalForge.service");
  const save = await import("./saveUsdst.service");
  const { getRouteQuote } = await import("./route.service");
  const originalNetwork = config.networkId;
  const originalTolerance = settings.ROUTE_OUTPUT_TOLERANCE_BPS;
  (config as any).networkId = "route-output-tolerance-test";
  t.after(() => {
    (config as any).networkId = originalNetwork;
    (settings as any).ROUTE_OUTPUT_TOLERANCE_BPS = originalTolerance;
  });
  const pairs = [["a", "d"], ["a", "b"], ["b", "d"], ["a", "c"], ["c", "d"], ["b", "c"]];
  t.mock.method(swapping, "fetchMultiTokenStablePools", async () => []);
  t.mock.method(psm, "getPsmMintState", async () => ({ mintPaused: true }));
  t.mock.method(forge, "getConfigs", async () => ({ metals: [], payTokens: [] }));
  t.mock.method(save, "getSaveUsdstActionState", async () => null);
  t.mock.method(cirrus, "get", async (_token: string, path: string) => {
    if (path === `/${constants.PoolFactory}-allPools`) return { data: [{ key: 10 }] };
    if (path === `/${constants.Pool}`) return { data: pairs.map(([a, b]) => ({
      address: a + b, tokenA: { address: a, status: "2" },
      tokenB: { address: b, status: "2" }, tokenABalance: "100", tokenBBalance: "100",
      isPaused: false, isDisabled: false,
    })) };
    if (path === `/${constants.Token}`) {
      return { data: ["a", "b", "c", "d"].map((address) => ({ address, status: "2" })) };
    }
    return { data: [] };
  });
  t.mock.method(swapping, "fetchPoolTokenAddresses", async (_token: string, pool: string) => ({
    tokenA: pool[0], tokenB: pool[1],
  }));
  let outputs: string[];
  t.mock.method(trade, "getTradeQuotes", async (_token: string, tokenIn: string, tokenOut: string, amount: bigint) => {
    const pair = tokenIn + tokenOut;
    const amountOut = pair === "ad" ? outputs[0] : pair === "bd" ? outputs[1]
      : pair === "cd" ? outputs[amount === 300n ? 3 : 2]
      : pair === "bc" ? "300" : pair === "ab" || pair === "ac" ? "200" : null;
    if (amountOut === null) throw new Error("No executable pool");
    return {
      bestPoolAddress: pair,
      quotes: [{ poolAddress: pair, poolType: "v2", tokenIn, tokenOut,
        amountIn: String(amount), amountOut, feeAmount: "0", feeBps: 0,
        priceImpact: 0, poolLabel: "test" }],
    };
  });
  for (const [name, amounts, targets] of [
    ["marginal gain", ["100000", "100040", "90000", "90000"], ["ad"]],
    ["material gain", ["100000", "101000", "90000", "90000"], ["ab", "bd"]],
    ["exact boundary", ["99950", "100000", "90000", "90000"], ["ad"]],
    ["one unit outside boundary", ["99949", "100000", "90000", "90000"], ["ab", "bd"]],
    ["equal hops prefer output", ["90000", "99980", "100000", "90000"], ["ac", "cd"]],
    ["equal output prefers shorter", ["100000", "100000", "100000", "100000"], ["ad"]],
    ["tolerance cannot compound across candidates", ["99900", "99950", "90000", "100000"], ["ab", "bd"]],
    ["small amounts do not round into tolerance", ["1998", "1999", "1900", "1900"], ["ab", "bd"]],
    ["large amounts retain integer precision", ["999499999999999999999999", "1000000000000000000000000", "90000", "90000"], ["ab", "bd"]],
  ] as const) {
    await t.test(name, async () => {
      outputs = [...amounts];
      const quote = await getRouteQuote("token", "a", "d", 100n, 50);
      assert.deepEqual(quote.steps.map(({ target }) => target), targets);
      assert.equal(quote.amountOut, quote.steps[quote.steps.length - 1].amountOut);
      assert.equal(quote.minFinalOut, applyRouteSlippage(BigInt(quote.amountOut), 50).toString());
    });
  }
  (settings as any).ROUTE_OUTPUT_TOLERANCE_BPS = 0n;
  outputs = ["100000", "100001", "90000", "90000"];
  const strict = await getRouteQuote("token", "a", "d", 100n);
  assert.deepEqual(strict.steps.map(({ target }) => target), ["ab", "bd"]);
});

test("excludes repeated-pool paths while retaining direct and distinct-pool routes", async (t) => {
  const { cirrus } = await import("../../utils/appApiHelper");
  const { constants } = await import("../../config/constants");
  const config = await import("../../config/config");
  const trade = await import("./trade.service");
  const swapping = await import("../helpers/swapping.helper");
  const psm = await import("./psm.service");
  const forge = await import("./metalForge.service");
  const save = await import("./saveUsdst.service");
  const { getRouteQuote } = await import("./route.service");
  const originalNetwork = config.networkId;
  (config as any).networkId = "pool-reuse-test";
  t.after(() => { (config as any).networkId = originalNetwork; });
  const coins = ["a", "b", "c", "d"].map((tokenAddress, coinIndex) => ({ tokenAddress, coinIndex }));
  t.mock.method(swapping, "fetchMultiTokenStablePools", async () => [{
    address: "abcd", coins, tokenBalances: new Map(coins.map(({ tokenAddress }) => [tokenAddress, "10000"])),
    isPaused: false, isDisabled: false,
  }] as any);
  t.mock.method(swapping, "fetchPoolCoins", async () => coins);
  t.mock.method(psm, "getPsmMintState", async () => ({ mintPaused: true }));
  t.mock.method(forge, "getConfigs", async () => ({ metals: [], payTokens: [] }));
  t.mock.method(save, "getSaveUsdstActionState", async () => null);
  t.mock.method(cirrus, "get", async (_token: string, path: string) => {
    if (path === `/${constants.Token}`) {
      return { data: coins.map(({ tokenAddress }) => ({ address: tokenAddress, status: "2" })) };
    }
    if (path === `/${constants.PoolFactory}-allPools`) return { data: [{ key: "1" }] };
    return { data: [] };
  });
  const available = new Map<string, { pool: string; output: string }>([
    ["a:d", { pool: "abcd", output: "100" }],
    ["a:b", { pool: "0xABCD", output: "400" }],
    ["b:d", { pool: "abcd", output: "800" }],
    ["a:c", { pool: "1111", output: "90" }],
    ["c:d", { pool: "2222", output: "80" }],
  ]);
  t.mock.method(trade, "getTradeQuotes", async (_token: string, tokenIn: string, tokenOut: string, amount: bigint) => {
    const result = available.get(`${tokenIn}:${tokenOut}`);
    if (!result) throw new Error("No executable pool");
    return {
      bestPoolAddress: result.pool,
      quotes: [{ poolAddress: result.pool, poolType: "stable", tokenIn, tokenOut,
        amountIn: String(amount), amountOut: result.output, feeAmount: "0", feeBps: 0,
        priceImpact: 0, poolLabel: "test" }],
    };
  });
  const quote = () => getRouteQuote("token", "a", "d", 100n);
  const direct = await quote();
  assert.equal(direct.steps.length, 1);
  assert.equal(direct.amountOut, "100");
  available.delete("a:d");
  const alternative = await quote();
  assert.deepEqual(alternative.steps.map(({ target }) => target), ["1111", "2222"]);
  assert.equal(alternative.amountOut, "80", "rejects the optimistic 800-output repeated-pool route");
  available.delete("a:c");
  await assert.rejects(quote(), /No executable route/);
  available.delete("b:d");
  available.set("b:c", { pool: "1111", output: "300" });
  available.set("c:d", { pool: "abcd", output: "600" });
  await assert.rejects(quote(), /No executable route/, "also rejects non-adjacent pool reuse");
  available.set("c:d", { pool: "2222", output: "250" });
  const distinct = await quote();
  assert.deepEqual(distinct.steps.map(({ target }) => target), ["abcd", "1111", "2222"]);
  assert.equal(distinct.amountOut, "250");
});

test("forge quotes match both contract divisions and the resulting mint cap", async (t) => {
  const config = await import("../../config/config");
  const { constants, MAX_UINT256 } = await import("../../config/constants");
  const { cirrus } = await import("../../utils/appApiHelper");
  const swapping = await import("../helpers/swapping.helper");
  const psm = await import("./psm.service");
  const forge = await import("./metalForge.service");
  const save = await import("./saveUsdst.service");
  const { getRouteQuote } = await import("./route.service");
  const originalNetwork = config.networkId;
  const originalForge = config.metalForge;
  (config as any).networkId = "forge-rounding-test";
  (config as any).metalForge = "forge";
  t.after(() => { (config as any).networkId = originalNetwork; (config as any).metalForge = originalForge; });
  t.mock.method(cirrus, "get", async () => ({ data: [] }));
  t.mock.method(swapping, "fetchMultiTokenStablePools", async () => []);
  t.mock.method(psm, "getPsmMintState", async () => ({ mintPaused: true }));
  t.mock.method(save, "getSaveUsdstActionState", async () => null);
  const metal = { address: "metal", isEnabled: true, feeBps: "25", mintCap: String(MAX_UINT256),
    totalMinted: "0", price: "500000000000000000", name: "Metal", symbol: "METAL" };
  t.mock.method(forge, "getConfigs", async () => ({ metals: [metal], payTokens: [
    { address: "pay", price: "1500000000000000000" },
    { address: constants.USDST, price: "0" },
  ] }) as any);
  const quote = () => getRouteQuote("token", "pay", "metal", 10002n, 1);
  const result = await quote();
  assert.equal(result.steps[0].feeAmount, "25");
  assert.equal(result.amountOut, "29930", "single-floor arithmetic would overquote by one wei");
  assert.equal(result.minFinalOut, "29927");
  assert.equal(result.steps[0].minAmountOut, "29927");
  metal.mintCap = "29930";
  assert.equal((await quote()).amountOut, "29930", "exact cap remains executable");
  metal.totalMinted = "1";
  await assert.rejects(quote(), /No executable route/);
  metal.totalMinted = "0";
  const usdst = await getRouteQuote("token", constants.USDST, "metal", 10002n, 1);
  assert.equal(usdst.amountOut, "19954", "USDST principal is already denominated in USD");
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
  t.mock.method(yieldVault, "getYieldVaultInfo", async () => { throw new Error("Quotes must not load vault analytics"); });
  t.mock.method(yieldVault, "getYieldVaultActionState", async () => deployed ? ({
    totalShares: totals.totalShares, projectedActiveAssets: totals.pricingAssets,
    vaultAddress: "yield", assetAddress: "asset", shareSymbol: "YIELD", decimals: 18,
    paused,
  }) as any : null);
  for (const target of ["save", "yield"]) {
    const quote = await getRouteQuote("token", "asset", target, 100000000000000000000n);
    assert.equal(quote.amountOut, String(100000000000000000000n * BigInt(totals.totalShares) / BigInt(totals.pricingAssets)));
    assert.equal(quote.steps[0].target, target);
  }
  paused = true;
  for (const target of ["save", "yield"]) await assert.rejects(getRouteQuote("token", "asset", target, 100n), { name: "StratoError", status: 422, message: /No route/ });
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

test("yield vault quotes fetch only live accounting and funded accrual", async (t) => {
  const config = await import("../../config/config");
  const { constants } = await import("../../config/constants");
  const { cirrus } = await import("../../utils/appApiHelper");
  const auth = await import("../../utils/authHelper");
  const { getYieldVaultActionState } = await import("./yieldVault.service");
  const original = config.ethCarryVault;
  (config as any).ethCarryVault = "vault";
  t.after(() => { (config as any).ethCarryVault = original; });
  t.mock.method(auth, "getServiceToken", async () => "service-token");
  t.mock.method(Date, "now", () => 1_000_000);
  const state = {
    _asset: "asset", _totalSupply: "1000", _symbol: "YIELD", _paused: "false",
    vaultInitialized: "true", deployedAssets: "300", totalClaimableAssets: "100",
    _underlyingDecimals: 6,
  };
  const storage = {
    accrualInitialized: "false", accrualBaseAssets: "1000",
    perSecondSavingsRate: "1100000000000000000000000000", lastAccrual: "999",
    rewardDistributor: "distributor",
  };
  let idleBalance = "200";
  let rewardBalance = "60";
  let allowance = "40";
  let deployed = true;
  let calls = 0;
  t.mock.method(cirrus, "get", async (token: string, path: string, options: any) => {
    calls++;
    assert.equal(token, "service-token");
    if (path === `/${constants.YieldVault}`) return { data: deployed ? [state] : [] };
    if (path === "/storage") return { data: [storage] };
    if (path === `/${constants.Token}-_balances`) {
      assert.equal(options.params.address, "eq.asset");
      return { data: [{ value: options.params.key === "eq.vault" ? idleBalance : rewardBalance }] };
    }
    if (path === `/${constants.Token}-_allowances`) {
      assert.equal(options.params.key, "eq.distributor");
      assert.equal(options.params.key2, "eq.vault");
      return { data: [{ value: allowance }] };
    }
    assert.fail(`Unexpected analytics query: ${path}`);
  });
  assert.deepEqual(await getYieldVaultActionState("eth-carry"), {
    vaultAddress: "vault", assetAddress: "asset", shareSymbol: "YIELD", name: "ETH Yield Vault",
    decimals: 6, totalShares: "1000", projectedActiveAssets: "400", paused: false,
  });
  assert.equal(calls, 3);
  storage.accrualInitialized = "true";
  calls = 0;
  assert.equal((await getYieldVaultActionState("eth-carry"))?.projectedActiveAssets, "440");
  assert.equal(calls, 5);
  allowance = "200";
  assert.equal((await getYieldVaultActionState("eth-carry"))?.projectedActiveAssets, "460");
  rewardBalance = "200";
  assert.equal((await getYieldVaultActionState("eth-carry"))?.projectedActiveAssets, "500");
  idleBalance = "300";
  assert.equal((await getYieldVaultActionState("eth-carry"))?.projectedActiveAssets, "600");
  state._paused = "true";
  assert.equal((await getYieldVaultActionState("eth-carry"))?.paused, true);
  state._underlyingDecimals = 0;
  assert.equal((await getYieldVaultActionState("eth-carry"))?.decimals, 0);
  state.totalClaimableAssets = "10000";
  assert.equal((await getYieldVaultActionState("eth-carry"))?.projectedActiveAssets, "0");
  state.vaultInitialized = "false";
  assert.equal(await getYieldVaultActionState("eth-carry"), null);
  state.vaultInitialized = "true";
  state._asset = "";
  assert.equal(await getYieldVaultActionState("eth-carry"), null);
  deployed = false;
  assert.equal(await getYieldVaultActionState("eth-carry"), null);
  calls = 0;
  assert.equal(await getYieldVaultActionState("unknown"), null);
  (config as any).ethCarryVault = "";
  assert.equal(await getYieldVaultActionState("eth-carry"), null);
  assert.equal(calls, 0);
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

test("anonymous route assets omit the balances relationship", async (t) => {
  const { constants } = await import("../../config/constants");
  const { cirrus } = await import("../../utils/appApiHelper");
  const psm = await import("./psm.service");
  const forge = await import("./metalForge.service");
  const savings = await import("./saveUsdst.service");
  const vaults = await import("./yieldVault.service");
  const { getRouteAssets } = await import("./route.service");
  const config = await import("../../config/config");
  const previous = config.directMintPsm;
  (config as any).directMintPsm = "1".repeat(40);
  t.after(() => { (config as any).directMintPsm = previous; });
  t.mock.method(psm, "getPsmMintState", async () => ({ mintPaused: false, mintableToken: "2".repeat(40),
    mintConfigs: new Map([["3".repeat(40), { isEnabled: true, feeBps: "0", maxBalance: "100" }]]) } as any));
  t.mock.method(forge, "getConfigs", async () => ({ metals: [], payTokens: [] } as any));
  t.mock.method(savings, "getSaveUsdstActionState", async () => null);
  t.mock.method(vaults, "listVaultDefs", () => []);
  const selections: any[] = [];
  t.mock.method(cirrus, "get", async (_token: string, path: string, options: any) => {
    if (path === `/${constants.Token}`) selections.push(options.params);
    return { data: [] };
  });
  await getRouteAssets("service-token");
  assert.ok(selections.length > 0);
  assert.equal(selections.at(-1).select.includes("balances:"), false);
  await getRouteAssets("user-token", "4".repeat(40));
  assert.equal(selections.at(-1).select.includes("balances:"), true);
  assert.equal(selections.at(-1)["balances.key"], `eq.${"4".repeat(40)}`);
});

test("route assets price vault shares from projected backing for guests and signed-in users", async (t) => {
  const { getRouteAssets } = await import("./route.service");
  const { constants } = await import("../../config/constants");
  const config = await import("../../config/config");
  const { cirrus } = await import("../../utils/appApiHelper");
  const swapping = await import("../helpers/swapping.helper");
  const psm = await import("./psm.service");
  const forge = await import("./metalForge.service");
  const savings = await import("./saveUsdst.service");
  const vaults = await import("./yieldVault.service");
  const oracle = await import("./oracle.service");
  const snapshot = { ...config };
  t.after(() => Object.assign(config, snapshot));
  Object.assign(config, { networkId: "vault-price-test", tokenRouter: "1".repeat(40) });
  const gold = "a".repeat(40), vault = "b".repeat(40);
  let indexed = true, missingPrice = false, oracleFailure = false;
  let decimals = 18, totalShares = "100000000000000000000", pricingAssets = "125000000000000000000";
  t.mock.method(swapping, "fetchMultiTokenStablePools", async () => []);
  t.mock.method(psm, "getPsmMintState", async () => ({ mintPaused: true }));
  t.mock.method(forge, "getConfigs", async () => ({ metals: [], payTokens: [] }));
  t.mock.method(savings, "getSaveUsdstActionState", async () => null);
  t.mock.method(vaults, "listVaultDefs", () => [{ key: "goldst-yield", address: vault }] as any);
  t.mock.method(vaults, "getYieldVaultActionState", async () => ({
    vaultAddress: vault, assetAddress: gold, name: "GOLDST Yield Vault", shareSymbol: "yieldGOLDST",
    decimals, totalShares, projectedActiveAssets: pricingAssets, paused: false,
  }));
  t.mock.method(oracle, "getOraclePrices", async () => {
    if (oracleFailure) throw new Error("oracle unavailable");
    return new Map(missingPrice ? [] : [[`0x${gold.toUpperCase()}`, "4000000000000000000000"]]);
  });
  t.mock.method(cirrus, "get", async (_token: string, path: string) => {
    if (path === `/${constants.TokenRouter}-approvedYieldVaults`) return { data: [{ key: vault }] };
    if (path === `/${constants.Token}` && indexed) return { data: [{
      address: vault, _name: "GOLDST Yield Vault", _symbol: "yieldGOLDST", customDecimals: decimals,
      balances: [{ balance: "200" }], images: [{ value: "vault.png" }],
    }] };
    return { data: [] };
  });
  const read = async (user?: string) => (await getRouteAssets("token", user)).find(token => token.address === vault)!;
  for (const user of [undefined, "c".repeat(40)]) {
    const token = await read(user);
    assert.equal(token.price, "5000000000000000000000", "1.25 GOLDST per share at $4,000 gives $5,000");
    assert.equal(token.images[0].value, "vault.png", "pricing preserves existing token metadata");
    assert.equal(token.routeDestination, "vault", "deposit destinations do not depend on APY or token symbols");
  }
  indexed = false;
  assert.equal((await read()).routeDestination, "vault", "synthetic vault assets retain their destination category");
  assert.equal((await read()).price, "5000000000000000000000", "synthetic vault assets also receive a price");
  for (decimals of [0, 2, 6, 18]) {
    totalShares = (100n * 10n ** BigInt(decimals)).toString();
    pricingAssets = (125n * 10n ** BigInt(decimals)).toString();
    assert.equal((await read()).price, "5000000000000000000000");
  }
  totalShares = "0";
  pricingAssets = "0";
  assert.equal((await read()).price, "4000000000000000000000", "empty vaults start at one underlying unit per share");
  totalShares = "100";
  assert.equal((await read()).price, "0", "no backing cannot produce a positive price");
  pricingAssets = "125";
  missingPrice = true;
  assert.equal((await read()).price, "0", "missing oracle data remains unavailable");
  oracleFailure = true;
  assert.equal((await read()).price, "0", "cosmetic price failure does not hide route assets");
  const savingsAddress = "d".repeat(40);
  Object.assign(config, { saveUsdstVault: savingsAddress });
  t.mock.method(savings, "getSaveUsdstActionState", async () => ({
    vaultAddress: savingsAddress, assetAddress: gold, shareSymbol: "SAVINGS",
    totalShares: "0", pricingAssets: "0", maxDeposit: "1000", projectedExchangeRate: "1000000000000000000", paused: false,
  }));
  assert.equal((await getRouteAssets("token")).find(token => token.address === savingsAddress)?.routeDestination, "savings");
});

test("startup rejects router dependencies that disagree with backend quote configuration", async (t) => {
  const config = await import("../../config/config");
  const auth = await import("../../utils/authHelper");
  const { eth, cirrus } = await import("../../utils/appApiHelper");
  const snapshot = { ...config };
  t.after(() => Object.assign(config, snapshot));
  t.mock.method(auth, "getServiceToken", async () => "service-token");
  t.mock.method(eth, "get", async () => ({ data: { networkID: "114784819836269", networkName: "test" } }));
  let mismatch = "";
  t.mock.method(cirrus, "get", async (_token: string, path: string) => {
    if (path === "/BlockApps-ExternalAssetBridge") return { data: [{ tokenRouter: config.tokenRouter }] };
    const row: Record<string, unknown> = { initialized: true };
    for (const field of ["poolFactory", "poolV3Factory", "directMintPsm", "metalForge", "saveUsdstVault"] as const) {
      row[field] = field === mismatch ? "0".repeat(40) : `0x${config[field].toUpperCase().replace(/^0X/, "")}`;
    }
    return { data: [row] };
  });
  await config.initNetworkConfig();
  for (mismatch of ["poolFactory", "poolV3Factory", "directMintPsm", "metalForge", "saveUsdstVault"]) {
    await assert.rejects(config.initNetworkConfig(), new RegExp(`TokenRouter.${mismatch}`));
  }
});
