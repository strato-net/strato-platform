import { config } from "../config";
import { 
  confirmDepositBatch,
  confirmWithdrawalBatch, 
  finaliseWithdrawalBatch,
  handleRejectedWithdrawalBatch
} from "../services/bridgeService";
import { 
  getWithdrawalsByStatus
} from "../services/cirrusService";
import { monitorSafeTransactionStatus } from "../services/safeService";

export const startWithdrawalRequestPolling = async () => {
  const pollingInterval = config.polling.withdrawalInterval || 5 * 60 * 1000;
  const poll = async () => {
    try {
      console.log("🔄 Polling for withdrawal requests...");
      const initiatedWithdrawals = await getWithdrawalsByStatus("1");
      
      if (initiatedWithdrawals.length > 0) {
        console.log(`Found ${initiatedWithdrawals.length} initiated withdrawals to process`);
        await confirmWithdrawalBatch(initiatedWithdrawals);
      }
    } catch (e: any) {
      console.error('❌ Withdrawal request polling error:', e.message);
    }
  };

  await poll();
  setInterval(poll, pollingInterval);
};

export const startDepositInitiatedPolling = async () => {
  const pollingInterval = config.polling.withdrawalInterval || 5 * 60 * 1000;
  const poll = async () => {
    try {
      console.log("🔄 Polling for deposit initiated events...");
      const depositStatus = await getWithdrawalsByStatus("1");
      
      if (depositStatus.length > 0) {
        console.log(`Found ${depositStatus.length} deposit initiated events to process`);
        await confirmDepositBatch(depositStatus);
      }
    } catch (e: any) {
      console.error('❌ Deposit initiated polling error:', e.message);
    }
  };

  await poll();
  setInterval(poll, pollingInterval);
};

export const startWithdrawalTxPolling = async () => {
  const pollingInterval = config.polling.bridgeOutInterval || 5 * 60 * 1000;
  const poll = async () => {
    try {
      const data = await getWithdrawalsByStatus("2");

      if (!Array.isArray(data) || data.length === 0) {
        return;
      }

      for (const transaction of data) {
        try {
          // Get the destChainId from the withdrawal data
          const destChainId = BigInt(transaction.destChainId);
          const status = await monitorSafeTransactionStatus(transaction.key, destChainId);
          
          if (status === 'executed') {
            console.log(`✅ Processing executed withdrawal transaction: 0x${transaction.key}`);
            await finaliseWithdrawalBatch([transaction]);
            
          } else if (status === 'rejected') {
            console.log(`❌ Processing rejected withdrawal transaction: 0x${transaction.key}`);
            await handleRejectedWithdrawalBatch([transaction]);
            
          } else {
            console.log(`⏳ Withdrawal transaction 0x${transaction.key} still pending`);
          }
          
        } catch (err: any) {
          console.error(`❌ Failed to process withdrawal transaction ${transaction.key}:`, err);
        }
      }
      
    } catch (e: any) {
      console.error('❌ Withdrawal transaction polling error:', e.message);
    }
  };

  await poll();
  setInterval(poll, pollingInterval);
};

export const initializeMercataPolling = async () => {
  console.log("🚀 Initializing Mercata polling...");
  
  await startDepositInitiatedPolling();
  await startWithdrawalRequestPolling();
  await startWithdrawalTxPolling();
  
  console.log("✅ Mercata polling initialized");
};
