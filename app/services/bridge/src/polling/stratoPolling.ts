import { config } from "../config";
import {
  confirmDepositBatch,
  reviewDepositBatch,
  confirmNativeDepositBatch,
  reviewNativeDepositBatch,
  finalizeNativeWithdrawalBatch,
  queueManualNativeWithdrawalBatch,
  confirmWithdrawalBatch,
  finaliseWithdrawalBatch,
  handleRejectedWithdrawalBatch,
  processExternalWithdrawal,
  processPendingExternalWithdrawalReview,
  queueExternalWithdrawalReview,
} from "../services/bridgeService";
import { NonEmptyArray, WithdrawalInfo, NativeWithdrawalInfo, DepositInfo, NativeDepositInfo, ConfirmDepositArgs, ConfirmNativeDepositArgs } from "../types";
import {
  getWithdrawalsByStatus,
  getExternalWithdrawalsByStatus,
  getNativeWithdrawalsByStatus,
  getDepositsByStatus,
  getNativeDepositsByStatus,
  getSafeTxHashFromEvents,
} from "../services/cirrusService";
import { monitorSafeTransactionStatusBatch } from "../services/safeService";
import { logInfo, logError } from "../utils/logger";
import { safeToBigInt } from "../utils/utils";
import { verifyDepositsBatch } from "../services/verificationService";
import { verifyNativeRedemptionsBatch } from "../services/nativeVerificationService";
import { checkBalances } from "../utils/balanceCheck";

const POLLING_BATCH_SIZE = 10;

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const startNonOverlappingPolling = (
  operation: string,
  pollingInterval: number,
  poll: () => Promise<void>,
): void => {
  const run = async () => {
    try {
      await poll();
    } catch (e: any) {
      logError("StratoPolling", e as Error, { operation });
    } finally {
      setTimeout(run, pollingInterval);
    }
  };

  void run();
};

export const startWithdrawalRequestPolling = (): void => {
  const pollingInterval = config.polling.withdrawalInterval || 5 * 60 * 1000;

  const poll = async () => {
    try {
      // Check Voucher and USDST balances regularly
      await checkBalances();

      const initiatedWithdrawals: WithdrawalInfo[] = await getWithdrawalsByStatus("1");
      if (initiatedWithdrawals.length === 0) return;

      for (const batch of chunk(initiatedWithdrawals, POLLING_BATCH_SIZE)) {
        await confirmWithdrawalBatch(batch as NonEmptyArray<WithdrawalInfo>);
      }
    } catch (e: any) {
      logError("StratoPolling", e as Error, {
        operation: "startWithdrawalRequestPolling",
      });
    }
  };

  startNonOverlappingPolling(
    "startWithdrawalRequestPolling",
    pollingInterval,
    poll,
  );
};

export const startExternalWithdrawalPolling = (): void => {
  const pollingInterval = config.polling.withdrawalInterval || 5 * 60 * 1000;

  const poll = async () => {
    const [initiated, pendingReview, ready] = await Promise.all([
      getExternalWithdrawalsByStatus("1"),
      getExternalWithdrawalsByStatus("2"),
      getExternalWithdrawalsByStatus("3"),
    ]);
    const routineWithdrawals = [...initiated, ...ready].filter(
      (withdrawal) => !withdrawal.requiresManualReview,
    );

    for (const withdrawal of routineWithdrawals) {
      try {
        await processExternalWithdrawal(withdrawal);
      } catch (error) {
        logError("StratoPolling", error as Error, {
          operation: "processExternalWithdrawal",
          withdrawalId: withdrawal.withdrawalId,
        });
      }
    }
    for (const withdrawal of initiated.filter((item) => item.requiresManualReview)) {
      try {
        await queueExternalWithdrawalReview(withdrawal);
      } catch (error) {
        logError("StratoPolling", error as Error, {
          operation: "queueExternalWithdrawalReview",
          withdrawalId: withdrawal.withdrawalId,
        });
      }
    }
    for (const withdrawal of pendingReview) {
      try {
        await processPendingExternalWithdrawalReview(withdrawal);
      } catch (error) {
        logError("StratoPolling", error as Error, {
          operation: "processPendingExternalWithdrawalReview",
          withdrawalId: withdrawal.withdrawalId,
        });
      }
    }
    for (const withdrawal of ready.filter((item) => item.requiresManualReview)) {
      try {
        await processExternalWithdrawal(withdrawal, true);
      } catch (error) {
        logError("StratoPolling", error as Error, {
          operation: "resumeApprovedExternalWithdrawal",
          withdrawalId: withdrawal.withdrawalId,
        });
      }
    }
  };

  startNonOverlappingPolling(
    "startExternalWithdrawalPolling",
    pollingInterval,
    poll,
  );
};

export const startDepositInitiatedPolling = (): void => {
  const pollingInterval =
    Number((config as any)?.polling?.withdrawalInterval) || 5 * 60 * 1000;

  const poll = async () => {
    try {
      const deposits: DepositInfo[] = await getDepositsByStatus("1");
      if (!Array.isArray(deposits) || deposits.length === 0) return;

      const verificationResults = await verifyDepositsBatch(deposits);
      
      const results: ConfirmDepositArgs[] = deposits.map((deposit) => {
        const error = verificationResults.get(deposit.externalTxHash);
        if (error) {
          logError("StratoPolling", error, {
            operation: "verifyDepositTransferEvents",
            externalChainId: deposit.externalChainId,
            externalTxHash: deposit.externalTxHash,
          });
          return { externalChainId: deposit.externalChainId, externalTxHash: deposit.externalTxHash, stratoRecipient: deposit.stratoRecipient, verified: false as const };
        }
        return { externalChainId: deposit.externalChainId, externalTxHash: deposit.externalTxHash, stratoRecipient: deposit.stratoRecipient, verified: true as const };
      });

      const { verifiedDeposits, failedDeposits } = results.reduce(
        (acc, r) => {
          if (r.verified) {
            acc.verifiedDeposits.push(r);
          } else {
            acc.failedDeposits.push(r);
          }
          return acc;
        },
        { verifiedDeposits: [] as ConfirmDepositArgs[], failedDeposits: [] as ConfirmDepositArgs[] }
      );

      if (verifiedDeposits.length > 0) {
        for (const batch of chunk(verifiedDeposits, POLLING_BATCH_SIZE)) {
          await confirmDepositBatch(batch as NonEmptyArray<ConfirmDepositArgs>);
        }
      }

      if (failedDeposits.length > 0) {
        for (const batch of chunk(failedDeposits, POLLING_BATCH_SIZE)) {
          await reviewDepositBatch(batch as NonEmptyArray<ConfirmDepositArgs>);
        }
      }
    } catch (e: any) {
      logError("StratoPolling", e as Error, {
        operation: "startDepositInitiatedPolling",
      });
    }
  };

  startNonOverlappingPolling(
    "startDepositInitiatedPolling",
    pollingInterval,
    poll,
  );
};

export const startNativeDepositInitiatedPolling = (): void => {
  const pollingInterval =
    Number((config as any)?.polling?.withdrawalInterval) || 5 * 60 * 1000;

  const poll = async () => {
    try {
      const [initiatedDeposits, pendingReviewDeposits] = await Promise.all([
        getNativeDepositsByStatus("1"),
        getNativeDepositsByStatus("2"),
      ]);
      const depositsById = new Map<string, NativeDepositInfo>();
      for (const deposit of [...initiatedDeposits, ...pendingReviewDeposits]) {
        depositsById.set(deposit.depositId, deposit);
      }
      const deposits = [...depositsById.values()];
      if (!Array.isArray(deposits) || deposits.length === 0) return;

      const verificationResults = await verifyNativeRedemptionsBatch(deposits);

      const results: ConfirmNativeDepositArgs[] = deposits.map((deposit) => ({
        externalChainId: deposit.externalChainId,
        externalBridge: deposit.externalBridge,
        externalRedemptionId: deposit.externalRedemptionId,
        depositId: deposit.depositId,
        stratoRecipient: deposit.stratoRecipient,
        verified: verificationResults.get(deposit.depositId) === true,
      }));

      const { verifiedDeposits, failedDeposits } = results.reduce(
        (acc, result) => {
          if (result.verified) {
            acc.verifiedDeposits.push(result);
          } else {
            acc.failedDeposits.push(result);
          }
          return acc;
        },
        {
          verifiedDeposits: [] as ConfirmNativeDepositArgs[],
          failedDeposits: [] as ConfirmNativeDepositArgs[],
        },
      );

      if (verifiedDeposits.length > 0) {
        for (const batch of chunk(verifiedDeposits, POLLING_BATCH_SIZE)) {
          await confirmNativeDepositBatch(
            batch as NonEmptyArray<ConfirmNativeDepositArgs>,
          );
        }
      }

      if (failedDeposits.length > 0) {
        const initiatedFailedDeposits = failedDeposits.filter((deposit) => {
          const sourceDeposit = depositsById.get(deposit.depositId);
          return String(sourceDeposit?.bridgeStatus) === "1";
        });
        for (const batch of chunk(initiatedFailedDeposits, POLLING_BATCH_SIZE)) {
          await reviewNativeDepositBatch(
            batch as NonEmptyArray<ConfirmNativeDepositArgs>,
          );
        }
      }
    } catch (e: any) {
      logError("StratoPolling", e as Error, {
        operation: "startNativeDepositInitiatedPolling",
      });
    }
  };

  startNonOverlappingPolling(
    "startNativeDepositInitiatedPolling",
    pollingInterval,
    poll,
  );
};

export const startWithdrawalTxPolling = (): void => {
  const pollingInterval = config.polling.bridgeOutInterval ?? 5 * 60 * 1000;
  type Withdrawal = { id: Number, safeTxHash: string };
  const poll = async () => {
    try {
      const pending: WithdrawalInfo[] = await getWithdrawalsByStatus("2");
      if (!Array.isArray(pending) || pending.length === 0) return;

      // ids -> safeTxHash
      const ids = pending.map(w => String(w.withdrawalId));
      const hashMap = await getSafeTxHashFromEvents(ids);

      const toFinalize: Array<Number> = [];
      const toReject: Array<Number> = [];

      // Group ONLY items with hashes; collect no-hash separately
      const byChain = new Map<bigint, Array<Withdrawal>>();
      for (const w of pending) {
        const id = Number(w.withdrawalId);
        const h = hashMap[id];
        if (!h) {
          toReject.push(id); // or keep pending per your policy
          continue;
        }
        const cid = safeToBigInt(w.externalChainId);
        (byChain.get(cid) ?? byChain.set(cid, []).get(cid)!).push({ id, safeTxHash: h });
      }

      // Monitor per chain only the with-hash subset
      for (const [chainId, withdrawals] of byChain) {
        const statuses = await monitorSafeTransactionStatusBatch(withdrawals as NonEmptyArray<Withdrawal>, safeToBigInt(chainId));
        for (const { id } of withdrawals) {
          const st = statuses.get(id);
          if (st === "executed") toFinalize.push(id);
          else if (st === "rejected") toReject.push(id);
        }
      }

      if (toFinalize.length)
        for (const batch of chunk(toFinalize, POLLING_BATCH_SIZE)) {
          await finaliseWithdrawalBatch(batch as NonEmptyArray<Number>);
        }
      if (toReject.length)
        for (const batch of chunk(toReject, POLLING_BATCH_SIZE)) {
          await handleRejectedWithdrawalBatch(batch as NonEmptyArray<Number>);
        }
    } catch (e: any) {
      logError("StratoPolling", e as Error, {
        operation: "startWithdrawalTxPolling",
        error: e.message,
        errorStack: e.stack,
      });
    }
  };

  startNonOverlappingPolling("startWithdrawalTxPolling", pollingInterval, poll);
};

export const startNativeWithdrawalRequestPolling = (): void => {
  const pollingInterval = config.polling.withdrawalInterval || 5 * 60 * 1000;

  const poll = async () => {
    try {
      const initiatedWithdrawals: NativeWithdrawalInfo[] =
        await getNativeWithdrawalsByStatus("1");
      if (initiatedWithdrawals.length === 0) return;

      const instantWithdrawals = initiatedWithdrawals.filter(
        (withdrawal) => withdrawal.useInstantPath,
      );
      const approvalWithdrawals = initiatedWithdrawals.filter(
        (withdrawal) => !withdrawal.useInstantPath,
      );

      if (instantWithdrawals.length > 0) {
        for (const batch of chunk(instantWithdrawals, POLLING_BATCH_SIZE)) {
          await finalizeNativeWithdrawalBatch(
            batch as NonEmptyArray<NativeWithdrawalInfo>,
          );
        }
      }

      if (approvalWithdrawals.length > 0) {
        for (const batch of chunk(approvalWithdrawals, POLLING_BATCH_SIZE)) {
          await queueManualNativeWithdrawalBatch(
            batch as NonEmptyArray<NativeWithdrawalInfo>,
          );
        }
      }
    } catch (e: any) {
      logError("StratoPolling", e as Error, {
        operation: "startNativeWithdrawalRequestPolling",
      });
    }
  };

  startNonOverlappingPolling(
    "startNativeWithdrawalRequestPolling",
    pollingInterval,
    poll,
  );
};

export const startNativeWithdrawalTxPolling = (): void => {
  const pollingInterval = config.polling.bridgeOutInterval ?? 5 * 60 * 1000;

  const poll = async () => {
    try {
      const pending: NativeWithdrawalInfo[] = await getNativeWithdrawalsByStatus("2");
      if (!Array.isArray(pending) || pending.length === 0) return;

      const pendingInstantExecution: NativeWithdrawalInfo[] = [];
      const pendingManualExecution: NativeWithdrawalInfo[] = [];

      for (const w of pending) {
        if (w.useInstantPath) {
          pendingInstantExecution.push(w);
        } else {
          pendingManualExecution.push(w);
        }
      }

      if (pendingInstantExecution.length > 0) {
        for (const batch of chunk(pendingInstantExecution, POLLING_BATCH_SIZE)) {
          await finalizeNativeWithdrawalBatch(
            batch as NonEmptyArray<NativeWithdrawalInfo>,
          );
        }
      }
      if (pendingManualExecution.length > 0) {
        for (const batch of chunk(pendingManualExecution, POLLING_BATCH_SIZE)) {
          await queueManualNativeWithdrawalBatch(
            batch as NonEmptyArray<NativeWithdrawalInfo>,
          );
        }
      }
    } catch (e: any) {
      logError("StratoPolling", e as Error, {
        operation: "startNativeWithdrawalTxPolling",
        error: e.message,
        errorStack: e.stack,
      });
    }
  };

  startNonOverlappingPolling(
    "startNativeWithdrawalTxPolling",
    pollingInterval,
    poll,
  );
};

export const initializeStratoPolling = async () => {
  logInfo("StratoPolling", "Initializing STRATO polling...");

  startDepositInitiatedPolling();
  startNativeDepositInitiatedPolling();
  startWithdrawalRequestPolling();
  startExternalWithdrawalPolling();
  startNativeWithdrawalRequestPolling();
  startWithdrawalTxPolling();
  startNativeWithdrawalTxPolling();

  logInfo("StratoPolling", "STRATO polling initialized");
};
