import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  RouteExecuteParams,
  TransactionResponse,
  WithdrawalRequestParams,
} from "@strato/shared-types";
import { api, type WalletTxProgressEvent } from "@/lib/axios";
import type { RouteExecutionProgress, RouteTransactionProgress } from "@/interface/swap";
import { getFriendlyMessage, normalizeError } from "@/lib/bridge/utils";

export function useRouteExecute() {
  return useStratoExecution<RouteExecuteParams>("trade", () => "/trade/route");
}

export function useWithdrawalExecute() {
  return useStratoExecution<WithdrawalRequestParams>("withdrawal", params =>
    params.routeType === "native" ? "/trade/bridge/requestNativeWithdrawal" : "/trade/bridge/requestWithdrawal");
}

function useStratoExecution<T>(operation: "trade" | "withdrawal", endpoint: (params: T) => string) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<RouteExecutionProgress | null>(null);
  const mutation = useMutation({
    mutationFn: async (params: T) => {
      let transactions: RouteTransactionProgress[] = [];
      let executionFailed = false;
      setProgress({ status: "pending", message: `Preparing and submitting your ${operation}…`, transactions });
      const walletTxProgress = (event: WalletTxProgressEvent) => {
        const previous = transactions.find(tx => tx.index === event.index);
        transactions = [...transactions.filter(tx => tx.index !== event.index), {
          ...previous, ...event, submittedHash: event.status === "submitted" ? event.hash : previous?.submittedHash,
        }]
          .sort((a, b) => a.index - b.index);
        setProgress({ status: "pending", message: event.status === "signing"
          ? "Confirm the transaction in your wallet." : "Waiting for STRATO to confirm your transactions…", transactions });
      };
      try {
        const { data } = await api.post<TransactionResponse>(
          endpoint(params),
          params,
          { walletTxProgress } as any
        );
        if (data.status === "Failure") {
          executionFailed = true;
          throw new Error("execution reverted");
        }
        const confirmed = data.status === "Success";
        setProgress({
          status: confirmed ? "success" : "unconfirmed",
          message: confirmed ? (operation === "trade" ? "Your trade is confirmed." : "Your withdrawal request is confirmed on STRATO. Track the external transfer in Recent Transactions.") : `Your ${operation} request is still pending. Do not resubmit; check your activity for confirmation.`,
          transactions,
          hash: transactions.find(tx => tx.functionName === (operation === "trade" ? "executeRoute" : "requestWithdrawal"))?.hash || data.hash,
        });
        return data;
      } catch (error) {
        const normalized = normalizeError(error);
        const responseUnknown = !!(error as any)?.request && !(error as any)?.response;
        const unconfirmed = !executionFailed && (transactions.some(tx => tx.submittedHash) || responseUnknown) &&
          !transactions.some(tx => tx.status === "failed");
        setProgress({
          status: unconfirmed ? "unconfirmed" : "error",
          message: unconfirmed ? "Confirmation is unavailable. Do not resubmit; check your activity for the transaction status."
            : normalized.code === "UNKNOWN_ERROR" ? getFriendlyMessage(normalized.message) : normalized.userMessage,
          transactions,
        });
        throw error;
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["trade"] });
    },
  });
  return { ...mutation, progress, closeProgress: () => { if (!mutation.isPending) setProgress(null); } };
}
