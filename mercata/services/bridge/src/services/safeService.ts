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
    const tx = await retry(
      () => apiKit.getTransaction(safeTxHash),
      { logPrefix: "SafeService" }
    );

    if (tx.isExecuted) return "executed";

    const allTxs = await retry(
      () => apiKit.getMultisigTransactions(tx.safe, {
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
      operation: "monitorSafeTransactionStatus",
      safeTxHash,
      chainId: chainId.toString(),
    });
    return "pending";
  }
};

export default { createSafeTransactions, proposeSafeTransactions };
