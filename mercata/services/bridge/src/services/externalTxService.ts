import { getTransactionReceiptsBatch } from "./rpcService";
import { NonEmptyArray } from "../types";
import { isOkStatus } from "../utils/utils";

export const monitorExternalTransactionStatusBatch = async (
  withdrawals: NonEmptyArray<{ id: Number; txHash: string }>,
  chainId: bigint
): Promise<Map<Number, "executed" | "rejected" | "pending">> => {
  const results = new Map<Number, "executed" | "rejected" | "pending">();
  const txHashes = withdrawals.map((w) => w.txHash);
  const receipts = await getTransactionReceiptsBatch(Number(chainId), txHashes);

  for (const { id, txHash } of withdrawals) {
    const receipt = receipts.get(txHash);
    if (!receipt) {
      results.set(id, "pending");
      continue;
    }

    results.set(id, isOkStatus(receipt) ? "executed" : "rejected");
  }

  return results;
};

export default { monitorExternalTransactionStatusBatch };
