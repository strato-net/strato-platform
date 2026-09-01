import assert from "node:assert/strict";
import test from "node:test";
import { RouteAction, type RouteStepQuote, type TradeQuote } from "@strato/shared-types";
import { constants } from "../../config/constants";
import { cirrus } from "../../utils/appApiHelper";
import {
  applyRouteSlippage,
  fetchFactoryPoolIndex,
  findRoutePaths,
  toExecutableRouteStep,
} from "./route.service";
import { selectBestTradeQuote } from "./trade.service";

const swap = (tokenIn: string, tokenOut: string) => ({
  kind: "SWAP" as const,
  tokenIn,
  tokenOut,
});

const quote = (poolAddress: string, amountOut: string, partialFill = false): TradeQuote => ({
  poolAddress,
  poolType: "v3",
  poolLabel: "V3",
  tokenIn: "a",
  tokenOut: "b",
  exactOut: false,
  amountIn: "100",
  amountOut,
  feeAmount: "1",
  feeBps: 30,
  priceImpact: 0,
  partialFill,
  poolTvlUsd: 100,
});

test("applies route slippage in basis points", () => {
  assert.equal(applyRouteSlippage(1_000_000n, 50), 995_000n);
  assert.equal(applyRouteSlippage(1_000_000n, 0), 1_000_000n);
  assert.throws(() => applyRouteSlippage(1n, 10_000), /slippageBps/);
});

test("finds a direct route before longer alternatives", () => {
  const routes = findRoutePaths(
    [
      swap("a", "c"),
      swap("c", "b"),
      swap("a", "b"),
    ],
    "a",
    "b"
  );

  assert.equal(routes[0].length, 1);
  assert.deepEqual(routes[0].map(({ tokenIn, tokenOut }) => `${tokenIn}->${tokenOut}`), ["a->b"]);
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

test("does not select a partial V3 exact-input quote", () => {
  const partial = quote("partial", "120", true);
  const full = quote("full", "100");
  const active = new Map([
    ["partial", true],
    ["full", true],
  ]);

  assert.equal(selectBestTradeQuote([partial, full], active, false)?.poolAddress, "full");
  assert.equal(selectBestTradeQuote([partial], active, false), null);
});

test("resolves a factory pool index with a targeted query", async (t) => {
  const poolAddress = "1111111111111111111111111111111111111111";
  let requestPath = "";
  let requestParams: Record<string, string> = {};
  t.mock.method(cirrus, "get", async (_token: string, path: string, options: any) => {
    requestPath = path;
    requestParams = options.params;
    return { data: [{ key: "7", value: poolAddress }] } as any;
  });

  assert.equal(await fetchFactoryPoolIndex("token", poolAddress), "7");
  assert.equal(requestPath, `/${constants.PoolFactory}-allPools`);
  assert.equal(requestParams.address, `eq.${constants.poolFactory}`);
  assert.equal(requestParams.value, `eq.${poolAddress}`);
  assert.equal(requestParams.limit, "1");
});

test("encodes the factory pool index in the executable route step", () => {
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
