import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CompositeRouteQuoteResponse } from "@strato/shared-types";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { api } from "@/lib/axios";

export function useCompositeRouteQuote({
  externalChainId,
  externalToken,
  targetStratoToken,
  tokenOut,
  amountWei,
  slippageBps,
}: {
  externalChainId?: string;
  externalToken?: string;
  targetStratoToken?: string;
  tokenOut?: string;
  amountWei?: string;
  slippageBps: number;
}) {
  const debouncedAmount = useDebouncedValue(amountWei, 350);
  return useQuery({
    queryKey: [
      "trade",
      "bridge-route",
      externalChainId,
      externalToken,
      targetStratoToken,
      tokenOut,
      debouncedAmount,
      slippageBps,
    ],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<CompositeRouteQuoteResponse>(
        "/trade/bridge-route/quote",
        {
          params: {
            externalChainId,
            externalToken,
            targetStratoToken,
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
      !!externalChainId &&
      !!externalToken &&
      !!targetStratoToken &&
      !!tokenOut &&
      !!debouncedAmount &&
      debouncedAmount !== "0",
    placeholderData: keepPreviousData,
    refetchInterval: 10_000,
    retry: 1,
  });
}
