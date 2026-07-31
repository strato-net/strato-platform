import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/axios";
import { TradeQuoteResponse } from "@/interface";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

export interface UseTradeQuoteArgs {
  tokenIn?: string;
  tokenOut?: string;
  /** wei string of the independent (user-typed) side; "0"/undefined disables */
  amountWei?: string;
  exactOut: boolean;
}

/**
 * One debounced quote request covering every candidate pool for the pair.
 * The server simulates each pool type with its contract's exact math and
 * flags the best executable pool.
 */
export function useTradeQuote({ tokenIn, tokenOut, amountWei, exactOut }: UseTradeQuoteArgs) {
  const debouncedAmount = useDebouncedValue(amountWei, 350);
  const type = exactOut ? "EXACT_OUTPUT" : "EXACT_INPUT";
  const enabled =
    !!tokenIn && !!tokenOut && tokenIn !== tokenOut &&
    !!debouncedAmount && debouncedAmount !== "0";

  return useQuery({
    queryKey: ["trade", "quote", tokenIn, tokenOut, debouncedAmount, type],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<TradeQuoteResponse>("/trade/quote", {
        params: { tokenIn, tokenOut, amount: debouncedAmount, type },
        signal,
      });
      return data;
    },
    enabled,
    // keep the last quote rendered while a new amount is being quoted
    placeholderData: keepPreviousData,
    refetchInterval: 10_000,
    retry: 1,
  });
}
