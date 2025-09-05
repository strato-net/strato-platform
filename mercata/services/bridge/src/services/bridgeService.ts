import { config } from "../config";
import { execute } from "../utils/stratoHelper";
import sendEmail from "./emailService";
import { NonEmptyArray, Withdrawal, Deposit, SafeTransactionData } from "../types";
import { createSafeTransactions, proposeSafeTransactions } from "./safeService";
import { logInfo, logError } from "../utils/logger";

export const depositBatch = async (deposits: NonEmptyArray<Deposit>) => {
  const externalChainIds = deposits.map((deposit) => deposit.externalChainId);
  const externalTxHashes = deposits.map((deposit) => deposit.externalTxHash);
  const stratoTokens = deposits.map((deposit) => deposit.stratoToken);
  const stratoTokenAmounts = deposits.map((deposit) => deposit.stratoTokenAmount);
  const stratoRecipients = deposits.map((deposit) => deposit.stratoRecipient);
  const externalSenders = deposits.map((deposit) => deposit.externalSender);
  const mintUSDSTs = deposits.map((deposit) => deposit.mintUSDST);

  try {
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
  } catch (error) {
    const errorMessage = (error as Error).message;
    
    // Check if this is a duplicate key error (expected when multiple servers process same deposits)
    if (errorMessage.includes("MB: dup key")) {
      logInfo(
        "BridgeService",
        `Deposits already processed by another server: ${deposits.length} deposits (${externalTxHashes.join(", ")})`,
      );
      return; // Gracefully handle duplicate deposits
    }
    
    // Re-throw other errors
    throw error;
  }
};

export const confirmDepositBatch = async (deposits: NonEmptyArray<Deposit>) => {
  const externalChainIds = deposits.map((deposit) => deposit.externalChainId);
  const externalTxHashes = deposits.map((deposit) => deposit.externalTxHash);

  try {
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
  } catch (error) {
    const errorMessage = (error as Error).message;
    
    // Check if this is a bad state error (expected when multiple servers confirm same deposits)
    if (errorMessage.includes("MB: bad state")) {
      logInfo(
        "BridgeService",
        `Deposits already confirmed by another server: ${deposits.length} deposits (${externalTxHashes.join(", ")})`,
      );
      return; // Gracefully handle already confirmed deposits
    }
    
    // Re-throw other errors
    throw error;
  }
};

export const reviewDepositBatch = async (deposits: NonEmptyArray<Deposit>) => {
  const externalChainIds = deposits.map((deposit) => deposit.externalChainId);
  const externalTxHashes = deposits.map((deposit) => deposit.externalTxHash);

  try {
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
  } catch (error) {
    const errorMessage = (error as Error).message;
    
    // Check if this is a bad state error (expected when multiple servers review same deposits)
    if (errorMessage.includes("MB: bad state")) {
      logInfo(
        "BridgeService",
        `Deposits already reviewed by another server: ${deposits.length} deposits (${externalTxHashes.join(", ")})`,
      );
      return; // Gracefully handle already reviewed deposits
    }
    
    // Re-throw other errors
    throw error;
  }
};

export const confirmWithdrawalBatch = async (
  withdrawals: NonEmptyArray<Withdrawal>,
) => {
  const transactionProposals = await createSafeTransactions(withdrawals);

  if (transactionProposals && transactionProposals.length > 0) {
    const withdrawalIds = withdrawals.map((w) => w.withdrawalId!);
    const custodyTxHashes = transactionProposals.map((tx) => tx.safeTxHash);

    try {
      await execute({
        contractName: "MercataBridge",
        contractAddress: config.bridge.address!,
        method: "confirmWithdrawalBatch",
        args: {
          ids: withdrawalIds,
          custodyTxHashes,
        },
      });
      await proposeSafeTransactions(transactionProposals as NonEmptyArray<SafeTransactionData>);
    } catch (executeError) {
      const errorMessage = (executeError as Error).message;
      if (errorMessage.includes("MB: bad state")) {
        logInfo(
          "BridgeService",
          `Withdrawals already confirmed by another server: ${withdrawals.length} withdrawals (${withdrawalIds.join(", ")})`,
        );
        return;
      }
      throw executeError;
    }

    const emailPromises = withdrawals.map(async (withdrawal) => {
      try {
        await sendEmail(withdrawal.withdrawalId!);
        return "success";
      } catch (emailError) {
        logError("BridgeService", emailError as Error, {
          operation: "sendEmail",
          withdrawalId: withdrawal.withdrawalId!,
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
};

export const finaliseWithdrawalBatch = async (
  withdrawals: NonEmptyArray<Withdrawal>,
) => {
  const withdrawalIds = withdrawals.map((w) => w.withdrawalId!);
  const custodyTxHashes = withdrawals.map((w) => w.safeTxHash!);

  try {
    await execute({
      contractName: "MercataBridge",
      contractAddress: config.bridge.address!,
      method: "finaliseWithdrawalBatch",
      args: {
        ids: withdrawalIds,
        custodyTxHashes,
      },
    });

    logInfo(
      "BridgeService",
      `Successfully finalized ${withdrawals.length} withdrawals`,
    );
  } catch (error) {
    const errorMessage = (error as Error).message;
    
    // Check if this is a bad state error (expected when multiple servers finalize same withdrawals)
    if (errorMessage.includes("MB: bad state")) {
      logInfo(
        "BridgeService",
        `Withdrawals already finalized by another server: ${withdrawals.length} withdrawals (${withdrawalIds.join(", ")})`,
      );
      return; // Gracefully handle already finalized withdrawals
    }
    
    // Re-throw other errors
    throw error;
  }
};

export const handleRejectedWithdrawalBatch = async (
  withdrawals: NonEmptyArray<Withdrawal>,
) => {
  const withdrawalIds = withdrawals.map((w) => w.withdrawalId!);

  try {
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
  } catch (error) {
    const errorMessage = (error as Error).message;
    
    // Check if this is a not abortable error (expected when multiple servers abort same withdrawals)
    if (errorMessage.includes("MB: not abortable")) {
      logInfo(
        "BridgeService",
        `Withdrawals already aborted by another server: ${withdrawals.length} withdrawals (${withdrawalIds.join(", ")})`,
      );
      return; // Gracefully handle already aborted withdrawals
    }
    
    // Re-throw other errors
    throw error;
  }
};

export const updateLastProcessedBlock = async (
  externalChainId: number,
  blockNumber: number,
): Promise<void> => {
  await execute({
    contractName: "MercataBridge",
    contractAddress: config.bridge.address!,
    method: "setLastProcessedBlock",
    args: {
      externalChainId,
      lastProcessedBlock: blockNumber,
    },
  });
};
