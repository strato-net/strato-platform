import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/axios";
import { SwapHistoryEntry } from "@/interface";

interface TradeHistoryPage {
  data: (SwapHistoryEntry & { timestamp: string })[];
  totalCount: number;
}

export interface UseTradeHistoryArgs {
  tokenIn?: string;
  tokenOut?: string;
  page: number;
  limit: number;
  sender?: string;
}

/** Paginated pair history across all pool types (rows tagged with their pool). */
export function useTradeHistory({ tokenIn, tokenOut, page, limit, sender }: UseTradeHistoryArgs) {
  return useQuery({
    queryKey: ["trade", "history", tokenIn, tokenOut, page, limit, sender ?? null],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<TradeHistoryPage>(`/trade/history/${tokenIn}/${tokenOut}`, {
        params: { page, limit, ...(sender ? { sender } : {}) },
        signal,
      });
      return {
        entries: (data?.data ?? []).map((row) => ({ ...row, timestamp: new Date(row.timestamp) })),
        totalCount: data?.totalCount ?? 0,
      };
    },
    enabled: !!tokenIn && !!tokenOut && tokenIn !== tokenOut,
    placeholderData: keepPreviousData,
    retry: 1,
  });
}
