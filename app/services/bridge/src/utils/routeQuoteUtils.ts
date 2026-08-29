import {
  RouteQuoteResponse,
  RouteStep,
  RouteStepQuote,
} from "@strato/shared-types";

const normalizeAddress = (value: string): string =>
  value.toLowerCase().replace(/^0x/, "");

const toExecutableRouteStep = (step: RouteStepQuote): RouteStep => ({
  action: step.action,
  target: step.target,
  tokenIn: step.tokenIn,
  tokenOut: step.tokenOut,
  minAmountOut: step.minAmountOut,
  parameter1: step.parameter1,
  parameter2: step.parameter2,
  direction: step.direction,
  factoryPoolIndex: step.factoryPoolIndex,
});

export const getExecutableRouteSteps = (
  quote: RouteQuoteResponse,
  tokenIn: string,
  tokenOut: string,
  minFinalOut: string,
): RouteStep[] => {
  if (
    quote.steps.length === 0 ||
    quote.steps.length > 6 ||
    normalizeAddress(quote.steps[0].tokenIn) !== normalizeAddress(tokenIn) ||
    normalizeAddress(quote.steps[quote.steps.length - 1].tokenOut) !==
      normalizeAddress(tokenOut) ||
    BigInt(quote.amountOut) < BigInt(minFinalOut)
  ) {
    throw new Error("Route quote does not satisfy the deposit intent");
  }
  const quotedFinalOut = BigInt(quote.amountOut);
  const requestedFinalOut = BigInt(minFinalOut);
  return quote.steps.map((step) => {
    const proportionalMinimum =
      (BigInt(step.amountOut) * requestedFinalOut) / quotedFinalOut;
    return {
      ...toExecutableRouteStep(step),
      minAmountOut: (proportionalMinimum > 0n ? proportionalMinimum : 1n).toString(),
    };
  });
};
