import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/axios";
import { TradePool } from "@/interface";

/**
 * All pools that can trade the pair, normalized across pool types and oriented
 * to tokenIn -> tokenOut. Refetches on an interval so pool balances, spot rates
 * and TVL track on-chain state (replaces the old usePoolPolling on this page).
 *
 * The previous pair's pools are kept as placeholder while a new pair loads so
 * the pool cards don't unmount on token changes; consumers must not use
 * placeholder pools for math (see useDerivedTradeInfo's pair guard).
 */
export function useTradePairPools(tokenIn?: string, tokenOut?: string) {
  return useQuery({
    queryKey: ["trade", "pools", tokenIn, tokenOut],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<TradePool[]>(`/trade/pools/${tokenIn}/${tokenOut}`, { signal });
      return data ?? [];
    },
    enabled: !!tokenIn && !!tokenOut && tokenIn !== tokenOut,
    placeholderData: keepPreviousData,
    refetchInterval: 10_000,
    retry: 1,
  });
}
