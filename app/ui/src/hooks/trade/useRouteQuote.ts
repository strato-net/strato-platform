import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { RouteQuoteResponse } from "@strato/shared-types";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { api } from "@/lib/axios";

export function useRouteQuote({
  tokenIn,
  tokenOut,
  amountWei,
  slippageBps,
}: {
  tokenIn?: string;
  tokenOut?: string;
  amountWei?: string;
  slippageBps: number;
}) {
  const debouncedAmount = useDebouncedValue(amountWei, 350);
  return useQuery({
    queryKey: [
      "trade",
      "route",
      "quote",
      tokenIn,
      tokenOut,
      debouncedAmount,
      slippageBps,
    ],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<RouteQuoteResponse>(
        "/trade/route/quote",
        {
          params: {
            tokenIn,
            tokenOut,
            amount: debouncedAmount,
            slippageBps,
          },
          signal,
        }
      );
      return data;
    },
    enabled:
      !!tokenIn &&
      !!tokenOut &&
      tokenIn !== tokenOut &&
      !!debouncedAmount &&
      debouncedAmount !== "0",
    placeholderData: keepPreviousData,
    refetchInterval: 10_000,
    retry: 1,
  });
}
