import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/axios";
import { SwapToken } from "@/interface";

/** All tokens tradable on any pool (V2, stable, or V3). */
export function useTradeTokens() {
  return useQuery({
    queryKey: ["trade", "tokens"],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<SwapToken[]>("/trade/tokens", { signal });
      return data ?? [];
    },
    staleTime: 30_000,
    retry: 1,
  });
}

/** Tokens tradable against the given token. */
export function useTradePairableTokens(tokenAddress?: string) {
  return useQuery({
    queryKey: ["trade", "tokens", tokenAddress, "pairs"],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<SwapToken[]>(`/trade/tokens/${tokenAddress}/pairs`, { signal });
      return data ?? [];
    },
    enabled: !!tokenAddress,
    // keep the previous token's list rendered while a new one loads
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: 1,
  });
}
