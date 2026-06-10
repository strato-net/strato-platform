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

const normalizeSafeTxHash = (safeTxHash: string): string =>
  (safeTxHash.startsWith("0x") ? safeTxHash : `0x${safeTxHash}`).toLowerCase();

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
    if (tx.isExecuted && !tx.isSuccessful) return "rejected";

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

const getPendingSafeTxHashes = async (
  apiKit: SafeApiKit,
  safeAddress: string,
): Promise<Set<string>> => {
  const pending = new Set<string>();
  if (!safeAddress) return pending;

  const limit = 100;
  let offset = 0;
  while (true) {
    const response = await retry(
      () => apiKit.getPendingTransactions(safeAddress, {
        ordering: "nonce",
        limit,
        offset,
      }),
      { logPrefix: "SafeService" },
    );
    const results = (response as any)?.results || [];
    for (const tx of results) {
      if (tx?.safeTxHash) pending.add(normalizeSafeTxHash(tx.safeTxHash));
    }
    if (!response.next || results.length === 0) break;
    offset += limit;
  }

  return pending;
};

export const monitorSafeTransactionStatusBatch = async (
  withdrawals: NonEmptyArray<{ id: Number, safeTxHash: string }>,
  chainId: bigint
): Promise<Map<Number, "executed" | "rejected" | "pending">> => {
  if (!withdrawals.length) return new Map();

  const apiKit = new SafeApiKit({ chainId, apiKey: config.safe.apiKey });

  const results = new Map<Number, "executed" | "rejected" | "pending">();
  const pendingSafeTxHashes = new Set<string>();
  const safeAddresses = [...new Set([
    config.safe.address,
    config.safe.hotWalletAddress,
  ].filter(Boolean) as string[])];

  try {
    for (const safeAddress of safeAddresses) {
      const pendingHashes = await getPendingSafeTxHashes(apiKit, safeAddress);
      for (const safeTxHash of pendingHashes) pendingSafeTxHashes.add(safeTxHash);
    }
  } catch (e) {
    logError("SafeService", e as Error, {
      operation: "getPendingSafeTransactions",
      chainId: chainId.toString(),
    });
  }
  
  for (let i = 0; i < withdrawals.length; i++) {
    const { id, safeTxHash } = withdrawals[i];
    if (pendingSafeTxHashes.has(normalizeSafeTxHash(safeTxHash))) {
      results.set(id, "pending");
      continue;
    }

    const status = await checkSafeTxStatus(safeTxHash, apiKit);
    results.set(id, status);
    if (i < withdrawals.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return results;
};

export default { createSafeTransactions, proposeSafeTransactions, monitorSafeTransactionStatusBatch };
