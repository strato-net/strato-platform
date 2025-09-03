import SafeApiKit from "@safe-global/api-kit";
import { logError, logInfo } from "../utils/logger";
import { NonEmptyArray, Withdrawal, SafeTransactionData } from "../types";
import {
  CallCache,
  groupByChain,
  createWithdrawalProposals,
  proposeTransactions,
} from "../utils/safeHelper";
import { retry } from "../utils/api";
import { config } from "../config";

export const createSafeTransactions = async (
  withdrawals: NonEmptyArray<Withdrawal>,
): Promise<SafeTransactionData[]> => {
  const withdrawalsByChain = groupByChain(withdrawals);
  const callCache = new CallCache();

  const allTransactionProposals: SafeTransactionData[] = [];

  for (const [externalChainId, chainWithdrawals] of withdrawalsByChain) {
    const chainProposals = await createWithdrawalProposals(
      externalChainId,
      chainWithdrawals,
      callCache,
    );
    allTransactionProposals.push(...chainProposals);
  }

  logInfo(
    "SafeService",
    `Created ${allTransactionProposals.length} Safe transaction proposals for ${withdrawals.length} withdrawals`,
  );

  return allTransactionProposals;
};

export const proposeSafeTransactions = async (
  transactionProposals: NonEmptyArray<SafeTransactionData>,
): Promise<void> => {
  const proposalsByChain = groupByChain(transactionProposals);
  
  for (const [externalChainId, chainProposals] of proposalsByChain) {
    await proposeTransactions(chainProposals, externalChainId);
  }
  
  logInfo("SafeService", `Proposed ${transactionProposals.length} Safe transactions across ${proposalsByChain.size} chains`);
};

export const checkSafeTxStatus = async (
  transactionKey: string,
  apiKit: SafeApiKit,
): Promise<"executed" | "rejected" | "pending"> => {
  if (!transactionKey) return "pending";

  const safeTxHash = transactionKey.startsWith("0x")
    ? transactionKey
    : `0x${transactionKey}`;

  try {
    const tx = await retry(
      () => apiKit.getTransaction(safeTxHash),
      { logPrefix: "SafeService" }
    );

    if (tx.isExecuted && tx.isSuccessful) return "executed";

    const allTxs = await retry(
      () => apiKit.getMultisigTransactions(config.safe.address!, {
        nonce: tx.nonce,
      } as any),
      { logPrefix: "SafeService" }
    );

    const executedTx = (allTxs as any)?.results?.find(
      (m: any) => m?.nonce === tx.nonce && m?.isExecuted,
    );

    if (executedTx && executedTx.safeTxHash !== safeTxHash) {
      return "rejected";
    }

    return "pending";
  } catch (e) {
    logError("SafeService", e as Error, {
      operation: "checkSafeTxStatus",
      safeTxHash,
    });
    return "pending";
  }
};

export const monitorSafeTransactionStatusBatch = async (
  withdrawals: NonEmptyArray<Withdrawal & { safeTxHash: string }>,
  chainId: bigint
): Promise<Map<string, "executed" | "rejected" | "pending">> => {
  const results = new Map<string, "executed" | "rejected" | "pending">();
  
  if (!withdrawals.length) return results;

  const apiKit = new SafeApiKit({ chainId });

  // Process all withdrawals for this chain in parallel using the shared API kit
  const chainResults = await Promise.all(
    withdrawals.map(async (withdrawal) => {
      const withdrawalId = String(withdrawal.withdrawalId);
      const safeTxHash = withdrawal.safeTxHash;
      
      const status = await checkSafeTxStatus(safeTxHash, apiKit);
      return { withdrawalId, status };
    })
  );

  // Add results to the main results map
  chainResults.forEach(({ withdrawalId, status }) => {
    results.set(withdrawalId, status);
  });

  return results;
};

export default { createSafeTransactions, proposeSafeTransactions, monitorSafeTransactionStatusBatch };
