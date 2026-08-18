import assert from "node:assert/strict";
import test from "node:test";
import { RouteAction, RouteQuoteResponse } from "@strato/shared-types";
import { getExecutableRouteSteps } from "../utils/routeQuoteUtils";

const tokenIn = "1111111111111111111111111111111111111111";
const tokenOut = "2222222222222222222222222222222222222222";
const quote: RouteQuoteResponse = {
  tokenIn,
  tokenOut,
  amountIn: "100",
  amountOut: "95",
  minFinalOut: "90",
  slippageBps: 50,
  deadline: 1,
  steps: [{
    action: RouteAction.SAVE,
    target: "3333333333333333333333333333333333333333",
    tokenIn,
    tokenOut,
    minAmountOut: "90",
    parameter1: "0",
    parameter2: "0",
    direction: false,
    factoryPoolIndex: "0",
    amountIn: "100",
    amountOut: "95",
    feeAmount: "5",
    feeBps: 500,
    priceImpact: 0,
    label: "Save",
  }],
};

test("converts a valid quote into executable route steps", () => {
  const steps = getExecutableRouteSteps(quote, tokenIn, tokenOut, "90");
  assert.equal(steps.length, 1);
  assert.equal(steps[0].minAmountOut, "90");
  assert.equal("amountOut" in steps[0], false);
});

test("rejects a quote below the deposit minimum", () => {
  assert.throws(
    () => getExecutableRouteSteps(quote, tokenIn, tokenOut, "96"),
    /does not satisfy/,
  );
});
