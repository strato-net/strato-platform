import { config } from "../config";
import { execute } from "../utils/stratoHelper";
import sendEmail from "./emailService";
import { NonEmptyArray, Withdrawal, Deposit } from "../types";
import { createSafeTransactionsForWithdrawals, createRejectionTransaction } from "./safeService";
import { logInfo, logError } from "../utils/logger";

export const depositBatch = async (deposits: NonEmptyArray<Deposit>) => {
  const externalChainIds = deposits.map((deposit) => deposit.externalChainId);
  const externalTxHashes = deposits.map((deposit) => deposit.externalTxHash);
  const stratoTokens = deposits.map((deposit) => deposit.stratoToken);
  const stratoTokenAmounts = deposits.map((deposit) => deposit.stratoTokenAmount);
  const stratoRecipients = deposits.map((deposit) => deposit.stratoRecipient);
  const externalSenders = deposits.map((deposit) => deposit.externalSender);
  const mintUSDSTs = deposits.map((deposit) => deposit.mintUSDST);

  await execute({
    contractName: "MercataBridge",
    contractAddress: config.bridge.address!,
    method: "depositBatch",
    args: {
      externalChainIds,
      externalTxHashes,
      stratoTokens,
      stratoTokenAmounts,
      stratoRecipients,
      externalSenders,
      mintUSDSTs,
    },
  });

  logInfo(
    "BridgeService",
    `Successfully deposited ${deposits.length} deposits`,
  );
};

export const confirmDepositBatch = async (deposits: NonEmptyArray<Deposit>) => {
  const externalChainIds = deposits.map((deposit) => deposit.externalChainId);
  const externalTxHashes = deposits.map((deposit) => deposit.externalTxHash);

  await execute({
    contractName: "MercataBridge",
    contractAddress: config.bridge.address!,
    method: "confirmDepositBatch",
    args: {
      externalChainIds,
      externalTxHashes,
    },
  });

  logInfo(
    "BridgeService",
    `Successfully confirmed ${deposits.length} deposits`,
  );
};

export const reviewDepositBatch = async (deposits: NonEmptyArray<Deposit>) => {
  const externalChainIds = deposits.map((deposit) => deposit.externalChainId);
  const externalTxHashes = deposits.map((deposit) => deposit.externalTxHash);

  await execute({
    contractName: "MercataBridge",
    contractAddress: config.bridge.address!,
    method: "reviewDepositBatch",
    args: {
      externalChainIds,
      externalTxHashes,
    },
  });

  logInfo(
    "BridgeService",
    `Successfully set ${deposits.length} deposits to pending review`,
  );
};

export const confirmWithdrawalBatch = async (
  withdrawals: NonEmptyArray<Withdrawal>,
) => {
  let safeTxs: { safeTxHash: string; nonce: number }[] = [];
  
  try {
    safeTxs = await createSafeTransactionsForWithdrawals(withdrawals);

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

      const emailPromises = withdrawals.map(async (withdrawal) => {
        try {
          await sendEmail(withdrawal.id || withdrawal.withdrawalId!);
          return "success";
        } catch (emailError) {
          logError("BridgeService", emailError as Error, {
            operation: "sendEmail",
            withdrawalId: withdrawal.id || withdrawal.withdrawalId!,
          });
          return "failed";
        }
      });

      const emailResults = await Promise.all(emailPromises);
      const successCount = emailResults.filter((r) => r === "success").length;
      const failureCount = emailResults.filter((r) => r === "failed").length;
      logInfo(
        "BridgeService",
        `Email notifications: ${successCount} sent, ${failureCount} failed for batch of ${withdrawals.length} withdrawals`,
      );
    }
  } catch (error) {
    if (safeTxs.length > 0) {
      for (const safeTx of safeTxs) {
        try {
          const withdrawal = withdrawals.find(w => w.safeTxHash === safeTx.safeTxHash) || withdrawals[0];
          const chainId = Number(withdrawal.destChainId);
          
          await createRejectionTransaction(chainId, safeTx.nonce);
        } catch (rejectError) {
          throw rejectError;
        }
      }
    }

    throw error;
  }
};

export const finaliseWithdrawalBatch = async (
  withdrawals: NonEmptyArray<Withdrawal>,
) => {
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

export const handleRejectedWithdrawalBatch = async (
  withdrawals: NonEmptyArray<Withdrawal>,
) => {
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
