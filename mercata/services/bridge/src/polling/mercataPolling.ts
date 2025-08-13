import { config } from "../config";
import { 
  confirmDepositBatch,
  confirmWithdrawalBatch, 
  finaliseWithdrawalBatch,
  handleRejectedWithdrawalBatch
} from "../services/bridgeService";
import { 
  getWithdrawalsByStatus,
  getDepositsByStatus
} from "../services/cirrusService";
import { monitorSafeTransactionStatus } from "../services/safeService";
import { logInfo, logError } from "../utils/logger";

export const startWithdrawalRequestPolling = async () => {
  const pollingInterval = config.polling.withdrawalInterval || 5 * 60 * 1000;
  const poll = async () => {
    try {
      const initiatedWithdrawals = await getWithdrawalsByStatus("1");
      
      if (initiatedWithdrawals.length > 0) {
        await confirmWithdrawalBatch(initiatedWithdrawals);
      }
    } catch (e: any) {
      logError('MercataPolling', e as Error, { operation: 'startWithdrawalRequestPolling' });
    }
  };

  poll();
  setInterval(poll, pollingInterval);
};

export const startDepositInitiatedPolling = async () => {
  const pollingInterval = config.polling.withdrawalInterval || 5 * 60 * 1000;
  const poll = async () => {
    try {
      const depositStatus = await getDepositsByStatus("1");
      
      if (depositStatus.length > 0) {
        await confirmDepositBatch(depositStatus);
      }
    } catch (e: any) {
      logError('MercataPolling', e as Error, { operation: 'startDepositInitiatedPolling' });
    }
  };

  poll();
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
            await finaliseWithdrawalBatch([transaction]);
          } else if (status === 'rejected') {
            await handleRejectedWithdrawalBatch([transaction]);
          }
          // Skip pending transactions
        } catch (err: any) {
          // Continue processing other transactions even if one fails
          continue;
        }
      }
    } catch (e: any) {
      logError('MercataPolling', e as Error, { operation: 'startWithdrawalTxPolling' });
    }
  };

  poll();
  setInterval(poll, pollingInterval);
};

export const initializeMercataPolling = async () => {
  logInfo('MercataPolling', "Initializing Mercata polling...");
  
  await startDepositInitiatedPolling();
  await startWithdrawalRequestPolling();
  await startWithdrawalTxPolling();
  
  logInfo('MercataPolling', "Mercata polling initialized");
};
