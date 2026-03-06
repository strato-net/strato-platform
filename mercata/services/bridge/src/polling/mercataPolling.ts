import { config } from "../config";
import {
  confirmDepositBatch,
  reviewDepositBatch,
  confirmWithdrawalBatch,
  confirmWithdrawalBatchHotWallet,
  finaliseWithdrawalBatch,
  handleRejectedWithdrawalBatch,
} from "../services/bridgeService";
import { NonEmptyArray, WithdrawalInfo, DepositInfo, ConfirmDepositArgs } from "../types";
import {
  getWithdrawalsByStatus,
  getDepositsByStatus,
  getSafeTxHashFromEvents,
} from "../services/cirrusService";
import { monitorSafeTransactionStatusBatch } from "../services/safeService";
import { logInfo, logError } from "../utils/logger";
import { safeToBigInt } from "../utils/utils";
import { verifyDepositsBatch } from "../services/verificationService";
import { checkBalances } from "../utils/balanceCheck";

export const startWithdrawalRequestPolling = (): void => {
  const pollingInterval = config.polling.withdrawalInterval || 5 * 60 * 1000;
  const hotWalletThreshold = config.hotWallet.threshold;
  const hotWalletEnabled = !!config.hotWallet.privateKey && hotWalletThreshold > 0n;

  const poll = async () => {
    try {
      // Check Voucher and USDST balances regularly
      await checkBalances();

      const initiatedWithdrawals: WithdrawalInfo[] = await getWithdrawalsByStatus("1");
      if (initiatedWithdrawals.length === 0) return;

      if (hotWalletEnabled) {
        // Split into hot wallet (small) and SAFE (large) paths
        const hotWalletWithdrawals: WithdrawalInfo[] = [];
        const safeWithdrawals: WithdrawalInfo[] = [];

        for (const w of initiatedWithdrawals) {
          const amount = BigInt(w.stratoTokenAmount || "0");
          if (amount > 0n && amount <= hotWalletThreshold) {
            hotWalletWithdrawals.push(w);
          } else {
            safeWithdrawals.push(w);
          }
        }

        if (hotWalletWithdrawals.length > 0) {
          logInfo("MercataPolling", `Processing ${hotWalletWithdrawals.length} withdrawals via hot wallet (threshold: ${hotWalletThreshold})`);
          await confirmWithdrawalBatchHotWallet(hotWalletWithdrawals as NonEmptyArray<WithdrawalInfo>);
        }

        if (safeWithdrawals.length > 0) {
          await confirmWithdrawalBatch(safeWithdrawals as NonEmptyArray<WithdrawalInfo>);
        }
      } else {
        await confirmWithdrawalBatch(initiatedWithdrawals as NonEmptyArray<WithdrawalInfo>);
      }
    } catch (e: any) {
      logError("MercataPolling", e as Error, {
        operation: "startWithdrawalRequestPolling",
      });
    }
  };

  void poll();
  setInterval(poll, pollingInterval);
};

export const startDepositInitiatedPolling = (): void => {
  const pollingInterval =
    Number((config as any)?.polling?.withdrawalInterval) || 5 * 60 * 1000;

  const poll = async () => {
    try {
      const deposits: DepositInfo[] = await getDepositsByStatus("1");
      if (!Array.isArray(deposits) || deposits.length === 0) return;

      const verificationResults = await verifyDepositsBatch(deposits);
      
      const results: ConfirmDepositArgs[] = deposits.map((deposit) => {
        const error = verificationResults.get(deposit.externalTxHash);
        if (error) {
          logError("MercataPolling", error, {
            operation: "verifyDepositTransferEvents",
            externalChainId: deposit.externalChainId,
            externalTxHash: deposit.externalTxHash,
          });
          return { externalChainId: deposit.externalChainId, externalTxHash: deposit.externalTxHash, stratoRecipient: deposit.stratoRecipient, verified: false as const };
        }
        return { externalChainId: deposit.externalChainId, externalTxHash: deposit.externalTxHash, stratoRecipient: deposit.stratoRecipient, verified: true as const };
      });

      const { verifiedDeposits, failedDeposits } = results.reduce(
        (acc, r) => {
          if (r.verified) {
            acc.verifiedDeposits.push(r);
          } else {
            acc.failedDeposits.push(r);
          }
          return acc;
        },
        { verifiedDeposits: [] as ConfirmDepositArgs[], failedDeposits: [] as ConfirmDepositArgs[] }
      );

      if (verifiedDeposits.length > 0) {
        await confirmDepositBatch(
          verifiedDeposits as NonEmptyArray<ConfirmDepositArgs>
        );
      }

      if (failedDeposits.length > 0) {
        await reviewDepositBatch(
          failedDeposits as NonEmptyArray<ConfirmDepositArgs>
        );
      }
    } catch (e: any) {
      logError("MercataPolling", e as Error, {
        operation: "startDepositInitiatedPolling",
      });
    }
  };

  void poll();
  setInterval(poll, pollingInterval);
};

export const startWithdrawalTxPolling = (): void => {
  const pollingInterval = config.polling.bridgeOutInterval ?? 5 * 60 * 1000;
  type Withdrawal = { id: Number, safeTxHash: string };
  const poll = async () => {
    try {
      const pending: WithdrawalInfo[] = await getWithdrawalsByStatus("2");
      if (!Array.isArray(pending) || pending.length === 0) return;

      // ids -> safeTxHash
      const ids = pending.map(w => String(w.withdrawalId));
      const hashMap = await getSafeTxHashFromEvents(ids);

      const toFinalize: Array<Number> = [];
      const toReject: Array<Number> = [];

      // Group ONLY items with hashes; collect no-hash separately
      const byChain = new Map<bigint, Array<Withdrawal>>();
      for (const w of pending) {
        const id = Number(w.withdrawalId);
        const h = hashMap[id];
        if (!h) {
          toReject.push(id); // or keep pending per your policy
          continue;
        }
        const cid = safeToBigInt(w.externalChainId);
        (byChain.get(cid) ?? byChain.set(cid, []).get(cid)!).push({ id, safeTxHash: h });
      }

      // Monitor per chain only the with-hash subset
      for (const [chainId, withdrawals] of byChain) {
        const statuses = await monitorSafeTransactionStatusBatch(withdrawals as NonEmptyArray<Withdrawal>, safeToBigInt(chainId));
        for (const { id } of withdrawals) {
          const st = statuses.get(id);
          if (st === "executed") toFinalize.push(id);
          else if (st === "rejected") toReject.push(id);
        }
      }

      if (toFinalize.length)
        await finaliseWithdrawalBatch(toFinalize as NonEmptyArray<Number>);
      if (toReject.length)
        await handleRejectedWithdrawalBatch(toReject as NonEmptyArray<Number>);
    } catch (e: any) {
      logError("MercataPolling", e as Error, {
        operation: "startWithdrawalTxPolling",
        error: e.message,
        errorStack: e.stack,
      });
    }
  };

  void poll();
  setInterval(poll, pollingInterval);
};

export const initializeMercataPolling = async () => {
  logInfo("MercataPolling", "Initializing Mercata polling...");

  startDepositInitiatedPolling();
  startWithdrawalRequestPolling();
  startWithdrawalTxPolling();

  logInfo("MercataPolling", "Mercata polling initialized");
};
