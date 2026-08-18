import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RouteExecuteParams, TransactionResponse } from "@/interface";
import { api } from "@/lib/axios";

export function useRouteExecute() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: RouteExecuteParams) => {
      const { data } = await api.post<TransactionResponse>("/trade/route", params);
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["trade"] });
    },
  });
}
