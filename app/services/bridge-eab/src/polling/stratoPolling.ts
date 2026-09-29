import { processingIssueService, withdrawalProcessingContext, notifyProcessingIssues } from "../services/processingIssueService";
import { config } from "../config";
import {
  confirmNativeDepositBatch,
  reviewNativeDepositBatch,
  finalizeNativeWithdrawalBatch,
  queueManualNativeWithdrawalBatch,
  processExternalWithdrawal,
  processPendingExternalWithdrawalReview,
  queueExternalWithdrawalReview,
} from "../services/bridgeService";
import { NonEmptyArray, NativeWithdrawalInfo, NativeDepositInfo, ConfirmNativeDepositArgs } from "../types";
import {
  getExternalWithdrawalsByStatus,
  getNativeWithdrawalsByStatus,
  getNativeDepositsByStatus,
} from "../services/cirrusService";
import { logInfo, logError } from "../utils/logger";
import { verifyNativeRedemptionsBatch } from "../services/nativeVerificationService";
import { checkBalances } from "../utils/balanceCheck";
import { healthMonitor } from "../utils/healthMonitor";
import { notifyBridgeReviews, preparePendingWithdrawalRefunds } from "../services/bridgeReviewService";

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
    if (!healthMonitor.beginPoll(operation, pollingInterval)) return;
    try {
      await poll();
    } catch (e: any) {
      healthMonitor.failPoll(operation);
      logError("StratoPolling", e as Error, { operation });
    } finally {
      healthMonitor.finishPoll(operation);
      setTimeout(run, pollingInterval);
    }
  };

  void run();
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
      await processingIssueService.run(withdrawalProcessingContext("eab", withdrawal, "withdrawal-processing"),
        () => processExternalWithdrawal(withdrawal), String(withdrawal.bridgeStatus) !== "1");
    }
    for (const withdrawal of initiated.filter((item) => item.requiresManualReview)) {
      await processingIssueService.run(withdrawalProcessingContext("eab", withdrawal, "withdrawal-review"),
        () => queueExternalWithdrawalReview(withdrawal), String(withdrawal.bridgeStatus) !== "1");
    }
    for (const withdrawal of pendingReview) {
      await processingIssueService.run(withdrawalProcessingContext("eab", withdrawal, "withdrawal-review"),
        () => processPendingExternalWithdrawalReview(withdrawal), String(withdrawal.bridgeStatus) !== "1");
    }
    for (const withdrawal of ready.filter((item) => item.requiresManualReview)) {
      await processingIssueService.run(withdrawalProcessingContext("eab", withdrawal, "withdrawal-processing"),
        () => processExternalWithdrawal(withdrawal, true), String(withdrawal.bridgeStatus) !== "1");
    }
    await preparePendingWithdrawalRefunds();
  };

  startNonOverlappingPolling(
    "startExternalWithdrawalPolling",
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

      const results: ConfirmNativeDepositArgs[] = deposits.filter((deposit) => verificationResults.has(deposit.depositId)).map((deposit) => ({
        externalChainId: deposit.externalChainId,
        externalBridge: deposit.externalBridge,
        externalRedemptionId: deposit.externalRedemptionId,
        depositId: deposit.depositId,
        stratoRecipient: deposit.stratoRecipient,
        verified: verificationResults.get(deposit.depositId) === true,
        actionToken: deposit.actionToken,
        minFinalOut: deposit.minFinalOut,
        stratoToken: deposit.stratoToken,
        stratoTokenAmount: deposit.stratoTokenAmount,
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
        for (const deposit of verifiedDeposits) {
          try {
            const context = { source: "native" as const, chainId: String(deposit.externalChainId),
              bridge: config.nativeBridge.address!, reference: deposit.depositId, stage: "deposit-confirmation", token: deposit.stratoToken };
            await processingIssueService.run(context, () => confirmNativeDepositBatch([deposit]));
          } catch (error) {
            logError("StratoPolling", error as Error, { operation: "confirmNativeDeposit", depositId: deposit.depositId });
          }
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
      healthMonitor.failPoll("startNativeDepositInitiatedPolling");
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

      for (const withdrawal of instantWithdrawals) {
        await processingIssueService.run(withdrawalProcessingContext("native", withdrawal),
          () => finalizeNativeWithdrawalBatch([withdrawal]), String(withdrawal.bridgeStatus) !== "1");
      }

      for (const withdrawal of approvalWithdrawals) {
        await processingIssueService.run(withdrawalProcessingContext("native", withdrawal),
          () => queueManualNativeWithdrawalBatch([withdrawal]), String(withdrawal.bridgeStatus) !== "1");
      }
    } catch (e: any) {
      healthMonitor.failPoll("startNativeWithdrawalRequestPolling");
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

      for (const withdrawal of pendingInstantExecution) {
        await processingIssueService.run(withdrawalProcessingContext("native", withdrawal),
          () => finalizeNativeWithdrawalBatch([withdrawal]), String(withdrawal.bridgeStatus) !== "1");
      }
      for (const withdrawal of pendingManualExecution) {
        await processingIssueService.run(withdrawalProcessingContext("native", withdrawal),
          () => queueManualNativeWithdrawalBatch([withdrawal]), String(withdrawal.bridgeStatus) !== "1");
      }
    } catch (e: any) {
      healthMonitor.failPoll("startNativeWithdrawalTxPolling");
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

  startNonOverlappingPolling("checkBalances", config.polling.withdrawalInterval, checkBalances);
  startNativeDepositInitiatedPolling();
  startExternalWithdrawalPolling();
  startNativeWithdrawalRequestPolling();
  startNativeWithdrawalTxPolling();
  startNonOverlappingPolling("processingIssues", config.polling.withdrawalInterval || 5 * 60 * 1000, notifyProcessingIssues);
  if (config.email.approverEmails.length) {
    startNonOverlappingPolling("notifyBridgeReviews", config.polling.withdrawalInterval || 5 * 60 * 1000, notifyBridgeReviews);
  }

  logInfo("StratoPolling", "STRATO polling initialized");
};
