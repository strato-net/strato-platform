import { config } from "../config";
import {
  confirmDepositBatch,
  reviewDepositBatch,
  confirmWithdrawalBatch,
  finaliseWithdrawalBatch,
  handleRejectedWithdrawalBatch,
} from "../services/bridgeService";
import { NonEmptyArray, Withdrawal, Deposit } from "../types";
import {
  getWithdrawalsByStatus,
  getDepositsByStatus,
  getSafeTxHashFromEvents,
} from "../services/cirrusService";
import { monitorSafeTransactionStatusBatch } from "../services/safeService";
import { logInfo, logError } from "../utils/logger";
import { safeToBigInt } from "../utils/utils";
import { verifyDepositsBatch } from "../services/verificationService";

export const startWithdrawalRequestPolling = (): void => {
  const pollingInterval = config.polling.withdrawalInterval || 5 * 60 * 1000;
  const poll = async () => {
    try {
      const initiatedWithdrawals = await getWithdrawalsByStatus("1");

      if (initiatedWithdrawals.length > 0) {
        await confirmWithdrawalBatch(
          initiatedWithdrawals as NonEmptyArray<Withdrawal>,
        );
      }
    } catch (e: any) {
      logError("MercataPolling", e as Error, {
        operation: "startWithdrawalRequestPolling",
      });
    }
  };

  void poll();
  setInterval(poll, pollingInterval);
};

export const startDepositInitiatedPolling = (): void => {
  const pollingInterval =
    Number((config as any)?.polling?.withdrawalInterval) || 5 * 60 * 1000;

  const poll = async () => {
    try {
      const deposits = await getDepositsByStatus("1");
      if (!Array.isArray(deposits) || deposits.length === 0) return;

      const verificationResults = await verifyDepositsBatch(deposits);
      
      const results = deposits.map((deposit) => {
        const error = verificationResults.get(deposit.srcTxHash);
        if (error) {
          logError("MercataPolling", error, {
            operation: "verifyDepositTransferEvents",
            depositId: (deposit as any)?.id,
          });
          return { deposit, verified: false as const };
        }
        return { deposit, verified: true as const };
      });

      const verifiedDeposits = results
        .filter(r => r.verified)
        .map(r => r.deposit);

      const failedDeposits = results
        .filter(r => !r.verified)
        .map(r => r.deposit);

      if (verifiedDeposits.length > 0) {
        await confirmDepositBatch(
          verifiedDeposits as NonEmptyArray<Deposit>
        );
      }

      if (failedDeposits.length > 0) {
        await reviewDepositBatch(
          failedDeposits as NonEmptyArray<Deposit>
        );
      }
    } catch (e: any) {
      logError("MercataPolling", e as Error, {
        operation: "startDepositInitiatedPolling",
      });
    }
  };

  void poll();
  setInterval(poll, pollingInterval);
};

export const startWithdrawalTxPolling = (): void => {
  const pollingInterval = config.polling.bridgeOutInterval ?? 5 * 60 * 1000;

  const poll = async () => {
    try {
      const pending = await getWithdrawalsByStatus("2");
      if (!Array.isArray(pending) || pending.length === 0) return;

      // ids -> safeTxHash
      const ids = pending.map(w => String(w.withdrawalId));
      const hashMap = await getSafeTxHashFromEvents(ids);

      const toFinalize: Array<Withdrawal & { safeTxHash: string }> = [];
      const toReject: Withdrawal[] = [];

      // Group ONLY items with hashes; collect no-hash separately
      const byChain = new Map<bigint, Array<Withdrawal & { safeTxHash: string }>>();
      for (const w of pending) {
        const id = String(w.withdrawalId);
        const h = hashMap[id];
        if (!h) {
          toReject.push(w); // or keep pending per your policy
          continue;
        }
        const cid = safeToBigInt(w.externalChainId);
        (byChain.get(cid) ?? byChain.set(cid, []).get(cid)!).push({ ...w, safeTxHash: h });
      }

      // Monitor per chain only the with-hash subset
      for (const [chainId, ws] of byChain) {
        const statuses = await monitorSafeTransactionStatusBatch(ws as NonEmptyArray<Withdrawal & { safeTxHash: string }>, chainId);
        for (const w of ws) {
          const id = String(w.withdrawalId);
          const st = statuses.get(id);
          if (st === "executed") toFinalize.push(w);
          else if (st === "rejected") toReject.push(w);
        }
      }

      if (toFinalize.length)
        await finaliseWithdrawalBatch(toFinalize as NonEmptyArray<Withdrawal>);
      if (toReject.length)
        await handleRejectedWithdrawalBatch(toReject as NonEmptyArray<Withdrawal>);
    } catch (e: any) {
      logError("MercataPolling", e as Error, {
        operation: "startWithdrawalTxPolling",
        error: e.message,
        errorStack: e.stack,
      });
    }
  };

  void poll();
  setInterval(poll, pollingInterval);
};

export const initializeMercataPolling = async () => {
  logInfo("MercataPolling", "Initializing Mercata polling...");

  startDepositInitiatedPolling();
  startWithdrawalRequestPolling();
  startWithdrawalTxPolling();

  logInfo("MercataPolling", "Mercata polling initialized");
};
