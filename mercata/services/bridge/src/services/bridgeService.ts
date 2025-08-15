import { config } from "../config";
import { execute } from "../utils/stratoHelper";
import sendEmail from "./emailService";
import { 
  createSafeTransactionsForWithdrawals, 
  checkExecutedSafeTransactions 
} from "./safeService";

import { logInfo, logError } from "../utils/logger";

export const depositBatch = async (deposits: any[]) => {
  if (!config.bridge.address) {
    throw new Error("Bridge contract address not configured");
  }

  try {
    const srcChainIds = deposits.map(deposit => deposit.srcChainId);
    const srcTxHashes = deposits.map(deposit => deposit.srcTxHash);
    const tokens = deposits.map(deposit => deposit.token);
    const amounts = deposits.map(deposit => deposit.amount);
    const users = deposits.map(deposit => deposit.user);
    console.log("deposits", deposits);
    const result = await execute({
      contractName: 'MercataBridge',
      contractAddress: config.bridge.address,
      method: "depositBatch",
      args: {
        srcChainIds: srcChainIds,
        srcTxHashes: srcTxHashes,
        tokens: tokens,
        amounts: amounts,
        users: users
      }
    });

    if (result?.status === "Success") {
      logInfo('BridgeService', `Successfully deposited ${deposits.length} deposits`);
    } else {
      throw new Error(`Failed to deposit batch: ${result?.status}`);
    }
  } catch (error) {
    logError('BridgeService', error as Error, { operation: 'depositBatch', depositCount: deposits.length });
    throw error;
  }
};

export const confirmDepositBatch = async (deposits: any[]) => {
  if (!config.bridge.address) {
    throw new Error("Bridge contract address not configured");
  }

  try {
    const srcChainIds = deposits.map(deposit => deposit.srcChainId);
    const srcTxHashes = deposits.map(deposit => deposit.srcTxHash);

    const result = await execute({
      contractName: 'MercataBridge',
      contractAddress: config.bridge.address,
      method: "confirmDepositBatch",
      args: {
        srcChainIds: srcChainIds,
        srcTxHashes: srcTxHashes
      }
    });

    if (result?.status === "Success") {
      logInfo('BridgeService', `Successfully confirmed ${deposits.length} deposits`);
    } else {
      throw new Error(`Failed to confirm deposits: ${result?.status}`);
    }
  } catch (error) {
    logError('BridgeService', error as Error, { operation: 'confirmDepositBatch', depositCount: deposits.length });
    throw error;
  }
};

export const confirmWithdrawalBatch = async (withdrawals: any[]) => {
  if (!config.bridge.address) {
    throw new Error("Bridge contract address not configured");
  }

  try {
    const safeTxs = await createSafeTransactionsForWithdrawals(withdrawals);
    
    if (safeTxs?.length > 0) {
      const withdrawalIds = withdrawals.map(w => w.id || w.withdrawalId);
      const custodyTxHashes = safeTxs.map(tx => tx.safeTxHash);

      const result = await execute({
        contractName: 'MercataBridge',
        contractAddress: config.bridge.address,
        method: "confirmWithdrawalBatch",
        args: {
          ids: withdrawalIds,
          custodyTxHashes: custodyTxHashes
        }
      });

      if (result?.status === "Success") {
        logInfo('BridgeService', `Successfully confirmed ${withdrawals.length} withdrawals`);
        
        // Send emails for successful withdrawals
        for (const withdrawal of withdrawals) {
          try {
            sendEmail(withdrawal.id || withdrawal.withdrawalId);
          } catch (emailError) {
            // Don't fail the whole operation for email errors
            logError('BridgeService', emailError as Error, { 
              operation: 'sendEmail', 
              withdrawalId: withdrawal.id || withdrawal.withdrawalId 
            });
          }
        }
      } else {
        throw new Error(`Failed to confirm withdrawals: ${result?.status || "Unknown error"}`);
      }
    }
  } catch (error) {
    logError('BridgeService', error as Error, { operation: 'confirmWithdrawalBatch', withdrawalCount: withdrawals.length });
    throw error;
  }
};

export const finaliseWithdrawalBatch = async (withdrawals: any[]) => {
  if (!config.bridge.address) {
    throw new Error("Bridge contract address not configured");
  }

  try {
    const executedTxs = await checkExecutedSafeTransactions(withdrawals);
    
    if (executedTxs?.length > 0) {
      const withdrawalIds = withdrawals.map(w => w.id || w.withdrawalId);
      const custodyTxHashes = executedTxs.map(tx => tx.hash);

      const result = await execute({
        contractName: 'MercataBridge',
        contractAddress: config.bridge.address,
        method: "finaliseWithdrawalBatch",
        args: {
          ids: withdrawalIds,
          custodyTxHashes: custodyTxHashes
        }
      });

      if (result?.status === "Success") {
        logInfo('BridgeService', `Successfully finalized ${withdrawals.length} withdrawals`);
      } else {
        throw new Error(`Failed to finalize withdrawals: ${result?.status || "Unknown error"}`);
      }
    }
  } catch (error) {
    logError('BridgeService', error as Error, { operation: 'finaliseWithdrawalBatch', withdrawalCount: withdrawals.length });
    throw error;
  }
};

export const handleRejectedWithdrawalBatch = async (withdrawals: any[]) => {
  if (!config.bridge.address) {
    throw new Error("Bridge contract address not configured");
  }

  try {
    const withdrawalIds = withdrawals.map(w => w.id || w.withdrawalId);

    const result = await execute({
      contractName: 'MercataBridge',
      contractAddress: config.bridge.address,
      method: "abortWithdrawalBatch",
      args: {
        ids: withdrawalIds
      }
    });

    if (result?.status === "Success") {
      logInfo('BridgeService', `Successfully aborted ${withdrawals.length} rejected withdrawals`);
    } else {
      throw new Error(`Failed to abort rejected withdrawals: ${result?.status || "Unknown error"}`);
    }
  } catch (error) {
    logError('BridgeService', error as Error, { operation: 'handleRejectedWithdrawalBatch', withdrawalCount: withdrawals.length });
    throw error;
  }
};
