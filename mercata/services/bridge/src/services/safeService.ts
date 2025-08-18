import SafeApiKit from "@safe-global/api-kit";
import { logError } from "../utils/logger";
import {
  SafeTransactionResult,
  NonEmptyArray,
  Withdrawal,
} from "../types";
import {
  CallCache,
  validateAndGroupWithdrawals,
  processChainWithdrawals,
} from "../utils/safeHelper";



export const createSafeTransactionsForWithdrawals = async (
  withdrawals: NonEmptyArray<Withdrawal>,
): Promise<SafeTransactionResult[]> => {
  const withdrawalsByChain = validateAndGroupWithdrawals(withdrawals);
  const callCache = new CallCache();

  const allSafeTxs: SafeTransactionResult[] = [];

  for (const [chainId, chainWithdrawals] of withdrawalsByChain) {
    const chainSafeTxs = await processChainWithdrawals(chainId, chainWithdrawals, callCache);
    allSafeTxs.push(...chainSafeTxs);
  }

  return allSafeTxs;
};

export const monitorSafeTransactionStatus = async (
  transactionKey: string,
  chainId: bigint,
): Promise<"executed" | "rejected" | "pending"> => {
  if (!transactionKey) return "pending";

  const safeTxHash = transactionKey.startsWith("0x")
    ? transactionKey
    : `0x${transactionKey}`;
  
  try {
    const apiKit = new SafeApiKit({ chainId });
    const tx = await apiKit.getTransaction(safeTxHash);
    
    if (tx.isExecuted) return "executed";

    const executed = await apiKit.getMultisigTransactions(tx.safe, {
      nonce: tx.nonce,
      executed: true,
    } as any);
    
    if (
      (executed as any)?.results?.some(
        (m: any) => m?.nonce === tx.nonce && m?.isExecuted,
      )
    ) {
      return "rejected";
    }
  } catch (e) {
    logError('SafeService', e as Error, {
      operation: 'monitorSafeTransactionStatus',
      safeTxHash,
      chainId: chainId.toString()
    });
  } finally {
    return "pending";
  }
};

export default { createSafeTransactionsForWithdrawals };
