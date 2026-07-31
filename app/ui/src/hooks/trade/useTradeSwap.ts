import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/axios";
import { TradeSwapParams } from "@/interface";

/**
 * Executes a swap on any pool type via the unified endpoint; the backend
 * dispatches to the right contract by pool address. Invalidates all trade
 * queries afterwards so quotes, pools and history reflect the new state.
 */
export function useTradeSwap() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: TradeSwapParams) => {
      const { data } = await api.post("/trade/swap", params);
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["trade"] });
    },
  });
}
