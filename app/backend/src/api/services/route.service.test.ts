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
