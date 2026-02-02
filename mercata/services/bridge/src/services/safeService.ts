import SafeApiKit from "@safe-global/api-kit";
import { logError, logInfo } from "../utils/logger";
import { NonEmptyArray, WithdrawalInfo, SafeTransactionData } from "../types";
import {
  groupByChain,
  createWithdrawalProposals,
  proposeTransactions,
} from "../utils/safeHelper";
import { retry } from "../utils/api";
import { config } from "../config";

export const createSafeTransactions = async (
  withdrawals: NonEmptyArray<WithdrawalInfo>,
): Promise<SafeTransactionData[]> => {
  const withdrawalsByChain = groupByChain(withdrawals);

  const allTransactionProposals: SafeTransactionData[] = [];

  for (const [externalChainId, chainWithdrawals] of withdrawalsByChain) {
    const chainProposals = await createWithdrawalProposals(
      externalChainId,
      chainWithdrawals as NonEmptyArray<WithdrawalInfo>
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
  withdrawals: NonEmptyArray<{ id: Number, safeTxHash: string }>,
  chainId: bigint
): Promise<Map<Number, "executed" | "rejected" | "pending">> => {
  if (!withdrawals.length) return new Map();

  const apiKit = new SafeApiKit({ chainId, apiKey: config.safe.apiKey });

  const results = new Map<Number, "executed" | "rejected" | "pending">();
  
  for (let i = 0; i < withdrawals.length; i++) {
    const { id, safeTxHash } = withdrawals[i];
    const status = await checkSafeTxStatus(safeTxHash, apiKit);
    results.set(id, status);
    if (i < withdrawals.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return results;
};

export default { createSafeTransactions, proposeSafeTransactions, monitorSafeTransactionStatusBatch };
