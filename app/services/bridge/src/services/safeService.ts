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
import { parseWithdrawalOrigin } from "../utils/withdrawalOrigin";
import { SafeMultisigTransactionResponse } from "@safe-global/types-kit";
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

export interface WithdrawalPayout {
  withdrawalId: string;
  safeTxHash: string;
  safeAddress: string;
  nonce: number;
  isExecuted: boolean;
}

const PAGE_SIZE = 100;
// A payout whose STRATO confirmation went missing surfaces within minutes, well inside this window
const RECENT_EXECUTED_LIMIT = 100;

/**
 * Payouts this bridge already has in the given Safes, keyed by withdrawal id: every queued
 * transaction that can still execute, plus the most recent successful executions.
 * Only transactions tagged by this bridge (see withdrawalOrigin.ts) are counted.
 */
export const findWithdrawalPayouts = async (
  chainId: number,
  safeAddresses: Array<string | undefined>,
): Promise<Map<string, WithdrawalPayout[]>> => {
  const apiKit = new SafeApiKit({ chainId: BigInt(chainId), apiKey: config.safe.apiKey });
  const payouts = new Map<string, WithdrawalPayout[]>();

  for (const safeAddress of new Set(safeAddresses.filter((a): a is string => !!a))) {
    const { nonce } = await retry(() => apiKit.getSafeInfo(safeAddress), { logPrefix: "SafeService" });
    const queued: SafeMultisigTransactionResponse[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await retry(
        () => apiKit.getPendingTransactions(safeAddress, { currentNonce: Number(nonce), limit: PAGE_SIZE, offset }),
        { logPrefix: "SafeService" },
      );
      queued.push(...page.results);
      if (!page.next || page.results.length === 0) break;
    }
    const executed = await retry(
      () => apiKit.getMultisigTransactions(safeAddress, { executed: true, ordering: "-nonce", limit: RECENT_EXECUTED_LIMIT }),
      { logPrefix: "SafeService" },
    );

    for (const tx of [...queued, ...executed.results.filter((t) => t.isSuccessful)]) {
      const withdrawalId = parseWithdrawalOrigin(config.bridge.address!, tx.origin);
      if (!withdrawalId) continue;
      const list = payouts.get(withdrawalId) ?? [];
      list.push({
        withdrawalId,
        safeTxHash: tx.safeTxHash,
        safeAddress,
        nonce: Number(tx.nonce),
        isExecuted: tx.isExecuted,
      });
      payouts.set(withdrawalId, list);
    }
  }
  return payouts;
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
