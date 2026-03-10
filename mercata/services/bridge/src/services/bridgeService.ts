import { ethers } from "ethers";
import { config, getChainRpcUrl, ERC20_ABI, ZERO_ADDRESS } from "../config";
import { execute } from "../utils/stratoHelper";
import sendEmail from "./emailService";
import { NonEmptyArray, WithdrawalInfo, DepositArgs, ConfirmDepositArgs, SafeTransactionData } from "../types";
import { createSafeTransactions, proposeSafeTransactions } from "./safeService";
import { logInfo, logError } from "../utils/logger";
import { mintVouchersForDeposits } from "./voucherService";
import { ensureHexPrefix } from "../utils/utils";

export const depositBatch = async (depositArgs: NonEmptyArray<DepositArgs>) => {
  const externalChainIds = depositArgs.map((deposit) => deposit.externalChainId);
  const externalSenders = depositArgs.map((deposit) => deposit.externalSender);
  const externalTokens = depositArgs.map((deposit) => deposit.externalToken);
  const externalTokenAmounts = depositArgs.map((deposit) => deposit.externalTokenAmount);
  const externalTxHashes = depositArgs.map((deposit) => deposit.externalTxHash);
  const stratoRecipients = depositArgs.map((deposit) => deposit.stratoRecipient);
  const targetStratoTokens = depositArgs.map((deposit) => deposit.targetStratoToken);

  try {
    await execute({
      contractName: "MercataBridge",
      contractAddress: config.bridge.address!,
      method: "depositBatch",
      args: {
        externalChainIds,
        externalTxHashes,
        externalTokens,
        externalTokenAmounts,
        stratoRecipients,
        externalSenders,
        targetStratoTokens,
      },
    });

    logInfo(
      "BridgeService",
      `Successfully deposited ${depositArgs.length} deposits`,
    );
  } catch (error) {
    const errorMessage = (error as Error).message;
    
    // Check if this is a duplicate key error (expected when multiple servers process same deposits)
    if (
      errorMessage.includes("MB: dup key") ||
      errorMessage.includes("MB: duplicate deposit")
    ) {
      logInfo(
        "BridgeService",
        `Deposits already processed by another server: ${depositArgs.length} deposits (${externalTxHashes.join(", ")})`,
      );
      return; // Gracefully handle duplicate deposits
    }
    
    // Re-throw other errors
    throw error;
  }
};

export const confirmDepositBatch = async (deposits: NonEmptyArray<ConfirmDepositArgs>) => {
  const externalChainIds = deposits.map((deposit) => deposit.externalChainId);
  const externalTxHashes = deposits.map((deposit) => deposit.externalTxHash);
  const stratoRecipients = deposits.map((deposit) => deposit.stratoRecipient);

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

    await mintVouchersForDeposits(stratoRecipients);
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

export const reviewDepositBatch = async (deposits: NonEmptyArray<ConfirmDepositArgs>) => {
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
  withdrawals: NonEmptyArray<WithdrawalInfo>,
) => {
  const transactionProposals = await createSafeTransactions(withdrawals as NonEmptyArray<WithdrawalInfo>);

  if (transactionProposals && transactionProposals.length > 0) {
    const withdrawalIds = withdrawals.map((w) => w.withdrawalId);
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
        await sendEmail(withdrawal.withdrawalId!, withdrawal.externalChainId);
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
  ids: NonEmptyArray<Number>,
) => {
  try {
    await execute({
      contractName: "MercataBridge",
      contractAddress: config.bridge.address!,
      method: "finaliseWithdrawalBatch",
      args: {
        ids,
      },
    });

    logInfo(
      "BridgeService",
      `Successfully finalized ${ids.length} withdrawals`,
    );
  } catch (error) {
    const errorMessage = (error as Error).message;
    
    // Check if this is a bad state error (expected when multiple servers finalize same withdrawals)
    if (errorMessage.includes("MB: bad state")) {
      logInfo(
        "BridgeService",
        `Withdrawals already finalized by another server: ${ids.length} withdrawals (${ids.join(", ")})`,
      );
      return; // Gracefully handle already finalized withdrawals
    }
    
    // Re-throw other errors
    throw error;
  }
};

/**
 * Send ERC20 tokens directly from the hot wallet EOA on the destination chain.
 * Returns the transaction hash on success.
 */
export const sendDirectTransfer = async (
  withdrawal: WithdrawalInfo,
): Promise<string> => {
  const privateKey = config.hotWallet.privateKey;
  if (!privateKey) throw new Error("HOT_WALLET_PRIVATE_KEY not configured");

  const chainId = Number(withdrawal.externalChainId);
  const rpcUrl = getChainRpcUrl(chainId);
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  const externalToken = ensureHexPrefix(withdrawal.externalToken);
  const recipient = ensureHexPrefix(withdrawal.externalRecipient);

  if (externalToken === ZERO_ADDRESS) {
    // Native ETH transfer
    const tx = await wallet.sendTransaction({
      to: recipient,
      value: BigInt(withdrawal.externalTokenAmount),
    });
    const receipt = await tx.wait();
    logInfo("BridgeService", `Hot wallet ETH transfer: ${receipt!.hash} to ${recipient} on chain ${chainId}`);
    return receipt!.hash;
  }

  // ERC20 transfer
  const erc20 = new ethers.Contract(externalToken, ERC20_ABI, wallet);
  const tx = await erc20.transfer(recipient, BigInt(withdrawal.externalTokenAmount));
  const receipt = await tx.wait();
  logInfo("BridgeService", `Hot wallet ERC20 transfer: ${receipt!.hash} to ${recipient} on chain ${chainId}`);
  return receipt!.hash;
};

/**
 * Process withdrawals below the hot wallet threshold by sending directly
 * from the hot wallet and immediately confirming + finalizing on-chain.
 */
export const confirmWithdrawalBatchHotWallet = async (
  withdrawals: NonEmptyArray<WithdrawalInfo>,
) => {
  for (const withdrawal of withdrawals) {
    try {
      const txHash = await sendDirectTransfer(withdrawal);

      // Confirm the withdrawal on-chain with the direct tx hash
      try {
        await execute({
          contractName: "MercataBridge",
          contractAddress: config.bridge.address!,
          method: "confirmWithdrawalBatch",
          args: {
            ids: [withdrawal.withdrawalId],
            custodyTxHashes: [txHash],
          },
        });
      } catch (err) {
        if ((err as Error).message?.includes("MB: bad state")) {
          logInfo("BridgeService", `Hot wallet withdrawal ${withdrawal.withdrawalId} already confirmed`);
        } else {
          throw err;
        }
      }

      // Immediately finalize
      try {
        await execute({
          contractName: "MercataBridge",
          contractAddress: config.bridge.address!,
          method: "finaliseWithdrawalBatch",
          args: { ids: [withdrawal.withdrawalId] },
        });
      } catch (err) {
        if ((err as Error).message?.includes("MB: bad state")) {
          logInfo("BridgeService", `Hot wallet withdrawal ${withdrawal.withdrawalId} already finalized`);
        } else {
          throw err;
        }
      }

      logInfo("BridgeService", `Hot wallet: withdrawal ${withdrawal.withdrawalId} confirmed+finalized (tx: ${txHash})`);
    } catch (err) {
      logError("BridgeService", err as Error, {
        operation: "confirmWithdrawalBatchHotWallet",
        withdrawalId: withdrawal.withdrawalId,
      });
    }
  }
};

export const handleRejectedWithdrawalBatch = async (
  ids: NonEmptyArray<Number>,
) => {

  try {
    await execute({
      contractName: "MercataBridge",
      contractAddress: config.bridge.address!,
      method: "abortWithdrawalBatch",
      args: {
        ids,
      },
    });

    logInfo(
      "BridgeService",
      `Successfully aborted ${ids.length} rejected withdrawals`,
    );
  } catch (error) {
    const errorMessage = (error as Error).message;
    
    // Check if this is a not abortable error (expected when multiple servers abort same withdrawals)
    if (errorMessage.includes("MB: not abortable")) {
      logInfo(
        "BridgeService",
        `Withdrawals already aborted by another server: ${ids.length} withdrawals (${ids.join(", ")})`,
      );
      return; // Gracefully handle already aborted withdrawals
    }
    
    // Re-throw other errors
    throw error;
  }
};
