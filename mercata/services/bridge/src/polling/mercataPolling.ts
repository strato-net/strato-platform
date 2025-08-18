import { config } from "../config";
import { 
  confirmDepositBatch,
  confirmWithdrawalBatch, 
  finaliseWithdrawalBatch,
  handleRejectedWithdrawalBatch
} from "../services/bridgeService";
import { 
  getWithdrawalsByStatus,
  getDepositsByStatus,
  getSafeTxHashFromEvents
} from "../services/cirrusService";
import { monitorSafeTransactionStatus } from "../services/safeService";
import { logInfo, logError } from "../utils/logger";
import { safeToBigInt } from "../utils/utils";

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
  const pollingInterval = config.polling.bridgeOutInterval ?? 5 * 60 * 1000;

  const poll = async () => {
    try {
      const pending = await getWithdrawalsByStatus("2");
      if (!Array.isArray(pending) || pending.length === 0) return;

      const idOf = (t: any) => String(t.id ?? t.withdrawalId);
      const ids = pending.map(idOf);
      const hashMap = await getSafeTxHashFromEvents(ids);

      const toFinalize: any[] = [];
      const toReject: any[] = [];

      await Promise.all(
        pending.map(async (tx) => {
          const safeTxHash = hashMap[idOf(tx)];
          if (!safeTxHash) {
            toReject.push(tx);
            return;
          }

          try {
            const status = await monitorSafeTransactionStatus(
              safeTxHash,
              safeToBigInt(tx.destChainId)
            );
            if (status === "executed") toFinalize.push(tx);
            else if (status === "rejected") toReject.push(tx);
          } catch (_) {
            toReject.push(tx);
          }
        })
      );

      if (toFinalize.length) await finaliseWithdrawalBatch(toFinalize);
      if (toReject.length) await handleRejectedWithdrawalBatch(toReject);
    } catch (e: any) {
      logError("MercataPolling", e as Error, { operation: "startWithdrawalTxPolling" });
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
