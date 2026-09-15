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
  steps: [
    {
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
    },
  ],
};

test("converts a valid quote into executable route steps", () => {
  const steps = getExecutableRouteSteps(quote, tokenIn, tokenOut, "90");
  assert.equal(steps.length, 1);
  assert.equal(steps[0].minAmountOut, "90");
  assert.equal(steps[0].action, "SAVE");
  assert.equal("amountOut" in steps[0], false);
});

test("serializes every route action using the STRATO enum name", () => {
  for (const action of [RouteAction.SWAP_V2, RouteAction.SWAP_STABLE, RouteAction.SWAP_V3,
    RouteAction.PSM_MINT, RouteAction.FORGE, RouteAction.SAVE, RouteAction.YIELD_VAULT_DEPOSIT]) {
    const steps = getExecutableRouteSteps({ ...quote, steps: [{ ...quote.steps[0], action }] }, tokenIn, tokenOut, "90");
    assert.equal(steps[0].action, RouteAction[action]);
  }
  assert.throws(() => getExecutableRouteSteps({ ...quote, steps: [{ ...quote.steps[0], action: 99 as RouteAction }] }, tokenIn, tokenOut, "90"), /Invalid action/);
});

test("rejects a quote below the deposit minimum", () => {
  assert.throws(
    () => getExecutableRouteSteps(quote, tokenIn, tokenOut, "96"),
    /does not satisfy/,
  );
});

test("binds every refreshed step to the signed final minimum", () => {
  const steps = getExecutableRouteSteps(
    {
      ...quote,
      amountOut: "80",
      steps: [
        { ...quote.steps[0], tokenOut: tokenIn, amountOut: "100" },
        { ...quote.steps[0], tokenIn, amountIn: "100", amountOut: "80" },
      ],
    },
    tokenIn,
    tokenOut,
    "72",
  );

  assert.deepEqual(
    steps.map((step) => step.minAmountOut),
    ["90", "72"],
  );
});
