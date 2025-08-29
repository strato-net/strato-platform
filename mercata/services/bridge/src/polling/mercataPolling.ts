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
import { monitorSafeTransactionStatus } from "../services/safeService";
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

      const idOf = (t: any) => String(t.id ?? t.withdrawalId);
      const ids = pending.map(idOf);
      const hashMap = await getSafeTxHashFromEvents(ids);

      const toFinalize: any[] = [];
      const toReject: any[] = [];

      await Promise.all(
        pending.map(async (tx) => {
          const safeTxHash = hashMap[idOf(tx)];
          if (!safeTxHash) {
            toReject.push(tx);
            return;
          }

          try {
            const status = await monitorSafeTransactionStatus(
              safeTxHash,
              safeToBigInt(tx.destChainId),
            );
            if (status === "executed") toFinalize.push({ ...tx, safeTxHash });
            else if (status === "rejected") toReject.push(tx);
          } catch (_) {
            toReject.push(tx);
          }
        }),
      );

      if (toFinalize.length)
        await finaliseWithdrawalBatch(toFinalize as NonEmptyArray<Withdrawal>);
      if (toReject.length)
        await handleRejectedWithdrawalBatch(
          toReject as NonEmptyArray<Withdrawal>,
        );
    } catch (e: any) {
      logError("MercataPolling", e as Error, {
        operation: "startWithdrawalTxPolling",
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
