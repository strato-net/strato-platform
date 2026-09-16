import SafeApiKit from "@safe-global/api-kit";
import { logError, logInfo } from "../utils/logger";
import { NonEmptyArray, WithdrawalInfo, SafeTransactionData } from "../types";
import {
  groupByChain,
  createWithdrawalProposals,
  initializeSafeForChain,
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

// Returns the safeTxHashes the Safe transaction service accepted
export const proposeSafeTransactions = async (
  transactionProposals: NonEmptyArray<SafeTransactionData>,
): Promise<string[]> => {
  const proposalsByChain = groupByChain(transactionProposals);
  const proposed: string[] = [];

  for (const [externalChainId, chainProposals] of proposalsByChain) {
    proposed.push(...(await proposeTransactions(chainProposals, externalChainId)));
  }

  logInfo("SafeService", `Proposed ${proposed.length} of ${transactionProposals.length} Safe transactions across ${proposalsByChain.size} chains`);
  return proposed;
};

export type SafeTxStatus = "executed" | "rejected" | "pending" | "not_found";

// The Safe service answers 404 for a transaction it has never been sent
const getSafeTransactionOrNull = async (apiKit: SafeApiKit, safeTxHash: string) => {
  try {
    return await apiKit.getTransaction(safeTxHash);
  } catch (error: any) {
    if (Number(error?.statusCode) === 404) return null;
    throw error;
  }
};

// The Safe's executed nonce: a transaction below it that has not run never will
export const getSafeOnChainNonce = async (
  chainId: number,
  safeAddress: string,
): Promise<number> => {
  const { protocolKit } = await initializeSafeForChain(chainId, safeAddress);
  return Number(await protocolKit.getNonce());
};

export const checkSafeTxStatus = async (
  transactionKey: string,
  apiKit: SafeApiKit,
): Promise<SafeTxStatus> => {
  if (!transactionKey) return "pending";

  const safeTxHash = transactionKey.startsWith("0x")
    ? transactionKey
    : `0x${transactionKey}`;

  try {
    const tx = await retry(
      () => getSafeTransactionOrNull(apiKit, safeTxHash),
      { logPrefix: "SafeService" }
    );
    if (!tx) {
      logInfo("SafeService", `Safe transaction status: not proposed`, { safeTxHash });
      return "not_found";
    }

    if (tx.isExecuted && tx.isSuccessful) {
      logInfo("SafeService", `Safe transaction status: executed`, { safeTxHash });
      return "executed";
    }

    const safeAddress = (tx as any).safe || config.safe.address!;
    const allTxs = await retry(
      () => apiKit.getMultisigTransactions(safeAddress, {
        nonce: tx.nonce,
      } as any),
      { logPrefix: "SafeService" }
    );

    const executedTx = (allTxs as any)?.results?.find(
      (m: any) => m?.nonce === tx.nonce && m?.isExecuted,
    );

    if (executedTx && executedTx.safeTxHash !== safeTxHash) {
      logInfo("SafeService", `Safe transaction status: rejected (replaced by another tx)`, { safeTxHash });
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
): Promise<Map<Number, SafeTxStatus>> => {
  if (!withdrawals.length) return new Map();

  const apiKit = new SafeApiKit({ chainId, apiKey: config.safe.apiKey });

  const results = new Map<Number, SafeTxStatus>();
  
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
