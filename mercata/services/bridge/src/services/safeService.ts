import SafeApiKit from "@safe-global/api-kit";
import { logError, logInfo } from "../utils/logger";
import { SafeTransactionResult, NonEmptyArray, Withdrawal } from "../types";
import {
  CallCache,
  validateAndGroupWithdrawals,
  processChainWithdrawals,
  initializeSafeForChain,
} from "../utils/safeHelper";
import { config } from "../config";

export const createSafeTransactionsForWithdrawals = async (
  withdrawals: NonEmptyArray<Withdrawal>,
): Promise<{ safeTxHash: string; nonce: number }[]> => {
  const withdrawalsByChain = validateAndGroupWithdrawals(withdrawals);
  const callCache = new CallCache();

  const allSafeTxs: { safeTxHash: string; nonce: number }[] = [];

  for (const [externalChainId, chainWithdrawals] of withdrawalsByChain) {
    const chainSafeTxs = await processChainWithdrawals(
      externalChainId,
      chainWithdrawals,
      callCache,
    );
    allSafeTxs.push(...chainSafeTxs);
  }

  logInfo(
    "SafeService",
    `Created ${allSafeTxs.length} Safe transactions for ${withdrawals.length} withdrawals`,
  );

  return allSafeTxs;
};

export const createRejectionTransaction = async (
  chainId: number,
  nonce: number,
): Promise<void> => {
  const { protocolKit, apiKit } = await initializeSafeForChain(chainId);
  const safeAddress = config.safe.address || "";
  const relayer = config.safe.safeOwnerAddress || "";
  
  const rejectionTransaction = await protocolKit.createRejectionTransaction(nonce);
  const rejectionHash = await protocolKit.getTransactionHash(rejectionTransaction);
  const signature = await protocolKit.signHash(rejectionHash);
  
  const proposalData = {
    safeAddress,
    safeTransactionData: rejectionTransaction.data,
    safeTxHash: rejectionHash,
    senderAddress: relayer,
    senderSignature: signature.data,
  };
  
  // Retry once on failure
  try {
    await apiKit.proposeTransaction(proposalData);
  } catch {
    await apiKit.proposeTransaction(proposalData);
  }
  
  logInfo(
    "SafeService",
    `Created rejection transaction for Safe ${safeAddress} with nonce ${nonce}`,
  );
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

    const allTxs = await apiKit.getMultisigTransactions(tx.safe, {
      nonce: tx.nonce,
    } as any);

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

export default { createSafeTransactionsForWithdrawals };
