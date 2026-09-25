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
  triageRejectedWithdrawals,
  proposeRecordedCustodyTxs,
} from "../services/bridgeService";
import { withdrawalProposalJournal } from "../services/withdrawalProposalJournal";
import { NonEmptyArray, WithdrawalInfo, NativeWithdrawalInfo, DepositInfo, NativeDepositInfo, ConfirmDepositArgs, ConfirmNativeDepositArgs } from "../types";
import {
  getWithdrawalsByStatus,
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
import { startNonOverlappingPolling as startPolling } from "../utils/polling";

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
): void => startPolling("StratoPolling", operation, pollingInterval, poll);

export const startWithdrawalRequestPolling = (): void => {
  const pollingInterval = config.polling.withdrawalInterval || 5 * 60 * 1000;

  const poll = async () => {
    try {
      // Check Voucher and USDST balances regularly
      await checkBalances();

      await withdrawalProposalJournal.prune([]);

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

type PendingWithdrawal = { id: Number, safeTxHash: string };

// Settle PENDING_REVIEW withdrawals from their custody tx: finalize executed payouts, abort rejected ones
export const processPendingWithdrawals = async (): Promise<void> => {
  const pending: WithdrawalInfo[] = await getWithdrawalsByStatus("2");
  if (!Array.isArray(pending) || pending.length === 0) return;

  // The record carries the custody tx it was confirmed with; the event table is only a fallback
  const withoutHash = pending
    .filter((w) => !w.custodyTxHash)
    .map((w) => String(w.withdrawalId));
  const eventHashes: Record<string, string | null> = withoutHash.length
    ? await getSafeTxHashFromEvents(withoutHash)
    : {};

  const toFinalize: Array<Number> = [];
  let toReject: Array<Number> = [];

  const byChain = new Map<bigint, Array<PendingWithdrawal>>();
  for (const w of pending) {
    const id = Number(w.withdrawalId);
    const safeTxHash = w.custodyTxHash || eventHashes[String(w.withdrawalId)];
    if (!safeTxHash) {
      // Never refund on a missing hash: the payout may already be queued or paid
      logError(
        "StratoPolling",
        new Error(`Withdrawal ${id} is pending review but no custody tx hash was found; leaving it for manual resolution`),
      );
      continue;
    }
    const cid = safeToBigInt(w.externalChainId);
    (byChain.get(cid) ?? byChain.set(cid, []).get(cid)!).push({ id, safeTxHash });
  }

  for (const [chainId, withdrawals] of byChain) {
    const statuses = await monitorSafeTransactionStatusBatch(withdrawals as NonEmptyArray<PendingWithdrawal>, safeToBigInt(chainId));
    const neverProposed: PendingWithdrawal[] = [];
    for (const withdrawal of withdrawals) {
      const st = statuses.get(withdrawal.id);
      if (st === "executed") toFinalize.push(withdrawal.id);
      else if (st === "rejected") toReject.push(withdrawal.id);
      else if (st === "not_found") neverProposed.push(withdrawal);
    }
    if (neverProposed.length) {
      toReject.push(...(await proposeRecordedCustodyTxs(neverProposed, Number(chainId))));
    }
  }

  if (toReject.length) {
    // "Rejected" only means the proposal we know of did not execute. Ask the
    // external chain whether the withdrawal was settled anyway before giving
    // any escrow back; a settled one is finalized, not refunded.
    const rejectedSet = new Set(toReject.map(Number));
    const triaged = await triageRejectedWithdrawals(
      pending.filter((w) => rejectedSet.has(Number(w.withdrawalId))),
    );
    toFinalize.push(...triaged.finalize);
    toReject = triaged.abort;
  }

  if (toFinalize.length)
    for (const batch of chunk(toFinalize, POLLING_BATCH_SIZE)) {
      await finaliseWithdrawalBatch(batch as NonEmptyArray<Number>);
      await withdrawalProposalJournal.prune(batch.map(String));
    }
  if (toReject.length)
    for (const batch of chunk(toReject, POLLING_BATCH_SIZE)) {
      await handleRejectedWithdrawalBatch(batch as NonEmptyArray<Number>);
      await withdrawalProposalJournal.prune(batch.map(String));
    }
};

export const startWithdrawalTxPolling = (): void => {
  const pollingInterval = config.polling.bridgeOutInterval ?? 5 * 60 * 1000;
  const poll = async () => {
    try {
      await processPendingWithdrawals();
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

      // EVERY native withdrawal goes through a custody-Safe proposal now.
      //
      // The "instant" lane had the relayer mint directly with a hot key that
      // held MINT_EXECUTOR_ROLE. That role has been revoked and removed: it was
      // a makeshift fast path, and it let one key mint with no Safe proposal,
      // which is how representation supply once ran ahead of what STRATO had
      // locked. Solvers are the fast path -- they front their own inventory --
      // and minting is the slow path. `useInstantPath` is still recorded on
      // chain, so it is deliberately ignored here rather than trusted: routing
      // on it would send those withdrawals to a mint call that now reverts.
      const instantWithdrawals: NativeWithdrawalInfo[] = [];
      const approvalWithdrawals = initiatedWithdrawals;

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
  startNativeWithdrawalRequestPolling();
  startWithdrawalTxPolling();
  startNativeWithdrawalTxPolling();

  logInfo("StratoPolling", "STRATO polling initialized");
};
