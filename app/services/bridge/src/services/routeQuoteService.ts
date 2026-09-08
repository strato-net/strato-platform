import {
  RouteQuoteResponse,
  RouteStep,
} from "@strato/shared-types";
import { config } from "../config";
import { app } from "../utils/api";
import { getExecutableRouteSteps } from "../utils/routeQuoteUtils";

export const fetchRouteSteps = async ({
  tokenIn,
  tokenOut,
  amountIn,
  minFinalOut,
}: {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  minFinalOut: string;
}): Promise<RouteStep[]> => {
  if (!config.api.appUrl) {
    throw new Error("STRATO_APP_API_URL is not configured");
  }

  const quote = await app.get<RouteQuoteResponse>("/api/trade/route/quote", {
    params: {
      tokenIn,
      tokenOut,
      amount: amountIn,
      slippageBps: config.api.routeQuoteSlippageBps,
    },
  });
  return getExecutableRouteSteps(quote, tokenIn, tokenOut, minFinalOut);
};
