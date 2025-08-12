import { config } from "../config";
import { contractCall } from "../utils/contractCall";
import sendEmail from "./emailService";
import { 
  createSafeTransactionsForWithdrawals, 
  checkExecutedSafeTransactions 
} from "./safeService";
import { mintVouchersForDeposits } from "../utils/voucherMinting";

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

    const result = await contractCall(
      'MercataBridge',
      config.bridge.address,
      "depositBatch",
      {
        srcChainIds: srcChainIds,
        srcTxHashes: srcTxHashes,
        tokens: tokens,
        amounts: amounts,
        users: users
      }
    );

    if (result?.status === "Success") {
      console.log(`✅ Deposited ${deposits.length} deposits`);
    } else {
      console.error(`❌ Failed to deposit:`, result?.status);
    }
  } catch (error) {
    console.error(`❌ Error depositing:`, error);
  }
};

export const confirmDepositBatch = async (deposits: any[]) => {
  if (!config.bridge.address) {
    throw new Error("Bridge contract address not configured");
  }

  try {
    const srcChainIds = deposits.map(deposit => deposit.srcChainId);
    const srcTxHashes = deposits.map(deposit => deposit.srcTxHash);

    const result = await contractCall(
      'MercataBridge',
      config.bridge.address,
      "confirmDepositBatch",
      {
        srcChainIds: srcChainIds,
        srcTxHashes: srcTxHashes
      }
    );

    if (result?.status === "Success") {
      console.log(`✅ Confirmed ${deposits.length} deposits`);
    } else {
      console.error(`❌ Failed to confirm deposits:`, result?.status);
    }
  } catch (error) {
    console.error(`❌ Error confirming deposits:`, error);
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

      const result = await contractCall(
        'MercataBridge',
        config.bridge.address,
        "confirmWithdrawalBatch",
        {
          ids: withdrawalIds,
          custodyTxHashes: custodyTxHashes
        }
      );

      if (result?.status === "Success") {
        console.log(`✅ Successfully confirmed ${withdrawals.length} withdrawals`);
        
        for (const withdrawal of withdrawals) {
          try {
            sendEmail(withdrawal.id || withdrawal.withdrawalId);
          } catch (emailError) {
            console.error(`❌ Failed to send email for withdrawal ${withdrawal.id}:`, emailError);
          }
        }
      } else {
        console.error(`❌ Failed to confirm withdrawals:`, result?.status || "Unknown error");
      }
    }
  } catch (error) {
    console.error("❌ Error in confirmWithdrawalBatch:", error);
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

      const result = await contractCall(
        'MercataBridge',
        config.bridge.address,
        "finaliseWithdrawalBatch",
        {
          ids: withdrawalIds,
          custodyTxHashes: custodyTxHashes
        }
      );

      if (result?.status === "Success") {
        console.log(`✅ Successfully finalized ${withdrawals.length} withdrawals`);
      } else {
        console.error(`❌ Failed to finalize withdrawals:`, result?.status || "Unknown error");
      }
    }
  } catch (error) {
    console.error("❌ Error in finaliseWithdrawalBatch:", error);
  }
};

export const handleRejectedWithdrawalBatch = async (withdrawals: any[]) => {
  if (!config.bridge.address) {
    throw new Error("Bridge contract address not configured");
  }

  try {
    const withdrawalIds = withdrawals.map(w => w.id || w.withdrawalId);

    const result = await contractCall(
      'MercataBridge',
      config.bridge.address,
      "abortWithdrawalBatch",
      {
        ids: withdrawalIds
      }
    );

    if (result?.status === "Success") {
      console.log(`✅ Successfully aborted ${withdrawals.length} rejected withdrawals`);
    } else {
      console.error(`❌ Failed to abort rejected withdrawals:`, result?.status || "Unknown error");
    }
  } catch (error) {
    console.error("❌ Error in handleRejectedWithdrawalBatch:", error);
  }
};
