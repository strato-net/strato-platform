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

test("bridge quote requests respect the backend slippage minimum", async (t) => {
  for (const name of ["BA_USERNAME", "BA_PASSWORD", "CLIENT_SECRET", "CLIENT_ID", "OPENID_DISCOVERY_URL", "BRIDGE_ADDRESS", "EXTERNAL_ASSET_BRIDGE_ADDRESS", "PRICE_ORACLE_ADDRESS", "SAFE_ADDRESS", "SAFE_PROPOSER_ADDRESS", "SAFE_PROPOSER_KMS_KEY_ID", "SAFE_PROPOSER_KMS_REGION", "RELAYER_BA_USERNAME", "RELAYER_BA_PASSWORD", "RELAYER_CLIENT_ID", "RELAYER_CLIENT_SECRET", "RELAYER_OPENID_DISCOVERY_URL"]) process.env[name] ||= "test";
  const { config } = await import("../config");
  const { app } = await import("../utils/api");
  const { fetchRouteSteps } = await import("./routeQuoteService");
  const previous = config.api.appUrl;
  config.api.appUrl = "https://app.example.test";
  t.after(() => { config.api.appUrl = previous; });
  t.mock.method(app, "get", async (_path: string, options: any) => {
    assert.equal(options.params.slippageBps, 1);
    return quote as any;
  });
  const steps = await fetchRouteSteps({ tokenIn, tokenOut, amountIn: "100", minFinalOut: "90" });
  assert.equal(steps[0].minAmountOut, "90", "the signed deposit minimum is preserved");
});
