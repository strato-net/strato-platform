import { config } from "../config";
import { execute } from "../utils/stratoHelper";
import sendEmail from "./emailService";
import {
  createSafeTransactionsForWithdrawals,
} from "./safeService";
import { NonEmptyArray, Withdrawal } from "../types";

import { logInfo, logError } from "../utils/logger";

export const depositBatch = async (deposits: NonEmptyArray<any>) => {
  const srcChainIds = deposits.map((deposit) => deposit.srcChainId);
  const srcTxHashes = deposits.map((deposit) => deposit.srcTxHash);
  const tokens = deposits.map((deposit) => deposit.token);
  const amounts = deposits.map((deposit) => deposit.amount);
  const users = deposits.map((deposit) => deposit.user);

  await execute({
    contractName: "MercataBridge",
    contractAddress: config.bridge.address!,
    method: "depositBatch",
    args: {
      srcChainIds: srcChainIds,
      srcTxHashes: srcTxHashes,
      tokens: tokens,
      amounts: amounts,
      users: users,
    },
  });

  logInfo(
    "BridgeService",
    `Successfully deposited ${deposits.length} deposits`,
  );
};

export const confirmDepositBatch = async (deposits: NonEmptyArray<any>) => {
  const srcChainIds = deposits.map((deposit) => deposit.srcChainId);
  const srcTxHashes = deposits.map((deposit) => deposit.srcTxHash);

  await execute({
    contractName: "MercataBridge",
    contractAddress: config.bridge.address!,
    method: "confirmDepositBatch",
    args: {
      srcChainIds: srcChainIds,
      srcTxHashes: srcTxHashes,
    },
  });

  logInfo(
    "BridgeService",
    `Successfully confirmed ${deposits.length} deposits`,
  );
};

export const confirmWithdrawalBatch = async (withdrawals: NonEmptyArray<Withdrawal>) => {
  const safeTxs = await createSafeTransactionsForWithdrawals(withdrawals);

  if (safeTxs?.length > 0) {
    const withdrawalIds = withdrawals.map((w) => w.id || w.withdrawalId!);
    const custodyTxHashes = safeTxs.map((tx) => tx.safeTxHash);

    await execute({
      contractName: "MercataBridge",
      contractAddress: config.bridge.address!,
      method: "confirmWithdrawalBatch",
      args: {
        ids: withdrawalIds,
        custodyTxHashes: custodyTxHashes,
      },
    });

    logInfo(
      "BridgeService",
      `Successfully confirmed ${withdrawals.length} withdrawals`,
    );

    // Send emails for successful withdrawals (parallel)
    const emailPromises = withdrawals.map(async (withdrawal) => {
      try {
        await sendEmail(withdrawal.id || withdrawal.withdrawalId!);
        return 'success';
      } catch (emailError) {
        logError("BridgeService", emailError as Error, {
          operation: "sendEmail",
          withdrawalId: withdrawal.id || withdrawal.withdrawalId!,
        });
        return 'failed';
      }
    });

    // Wait for all emails to complete and log results
    const emailResults = await Promise.all(emailPromises);
    const successCount = emailResults.filter(r => r === 'success').length;
    const failureCount = emailResults.filter(r => r === 'failed').length;
    logInfo(
      "BridgeService",
      `Email notifications: ${successCount} sent, ${failureCount} failed for batch of ${withdrawals.length} withdrawals`
    );
  }
};

export const finaliseWithdrawalBatch = async (withdrawals: NonEmptyArray<Withdrawal>) => {
  const withdrawalIds = withdrawals.map((w) => w.id || w.withdrawalId!);
  const custodyTxHashes = withdrawals.map((w) => w.safeTxHash!);

  await execute({
    contractName: "MercataBridge",
    contractAddress: config.bridge.address!,
    method: "finaliseWithdrawalBatch",
    args: {
      ids: withdrawalIds,
      custodyTxHashes: custodyTxHashes,
    },
  });

  logInfo(
    "BridgeService",
    `Successfully finalized ${withdrawals.length} withdrawals`,
  );
};

export const handleRejectedWithdrawalBatch = async (withdrawals: NonEmptyArray<Withdrawal>) => {
  const withdrawalIds = withdrawals.map((w) => w.id || w.withdrawalId!);

  await execute({
    contractName: "MercataBridge",
    contractAddress: config.bridge.address!,
    method: "abortWithdrawalBatch",
    args: {
      ids: withdrawalIds,
    },
  });

  logInfo(
    "BridgeService",
    `Successfully aborted ${withdrawals.length} rejected withdrawals`,
  );
};
