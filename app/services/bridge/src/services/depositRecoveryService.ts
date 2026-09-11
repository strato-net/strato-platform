import { getRecordedDepositReviews, getIndexedDepositSettlements } from "./cirrusService";
import { getTransactionReceiptsBatch } from "./rpcService";
import { recoverDepositObservation, matchesRecordedDepositReview } from "./depositEventService";
import { depositStateService } from "./depositStateService";
import { logError } from "../utils/logger";

export const recoverReviewedDeposit = async (
  externalChainId: number,
  depositRouter: string,
  depositId: string,
) => {
  const records = await getRecordedDepositReviews(externalChainId, { depositRouter, depositId });
  if (records.length !== 1) throw new Error("STRATO pending review is unavailable");
  const record = records[0];
  const receipts = await getTransactionReceiptsBatch(externalChainId, [record.externalTxHash]);
  const deposit = recoverDepositObservation(record, receipts.get(record.externalTxHash));
  return depositStateService.restoreRecordedReview(deposit);
};

export const reconcileRecordedDepositReviews = async (externalChainId: number): Promise<void> => {
  const [records, localEntries] = await Promise.all([
    getRecordedDepositReviews(externalChainId),
    depositStateService.listTracked(externalChainId),
  ]);
  const indexed = await getIndexedDepositSettlements(externalChainId,
    localEntries.filter((entry) => !entry.settlementIndexed).map(({ deposit }) => deposit));
  if (indexed.length) await depositStateService.markIndexedSettlements(externalChainId, indexed);
  const localReviews = localEntries.filter((entry) => entry.status === "review");
  const identity = (router: string, id: string) => `${router.toLowerCase().replace(/^0x/, "")}:${id}`;
  const cached = new Map(localReviews.filter((review) => review.reviewRecordedOnchain)
    .map(({ deposit }) => [identity(deposit.depositRouter, deposit.depositId), deposit]));
  const missing = records.filter((record) => {
    const deposit = cached.get(identity(record.depositRouter, record.depositId));
    return !deposit || !matchesRecordedDepositReview(deposit, record);
  });
  if (!missing.length) return;
  const hashes = [...new Set(missing.map((record) => record.externalTxHash))];
  const receipts = await getTransactionReceiptsBatch(externalChainId, hashes);
  for (const record of missing) {
    try {
      await depositStateService.restoreRecordedReview(
        recoverDepositObservation(record, receipts.get(record.externalTxHash)),
      );
    } catch (error) {
      logError("DepositRecovery", error as Error, {
        externalChainId, depositRouter: record.depositRouter, depositId: record.depositId,
      });
    }
  }
};
