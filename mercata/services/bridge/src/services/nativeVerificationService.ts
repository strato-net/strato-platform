import { getTransactionReceiptsBatch } from "./rpcService";
import { getNativeRepresentationBridgeAddress, NATIVE_REDEMPTION_EVENT_SIGNATURE } from "../config";
import { NativeDepositInfo } from "../types";
import { logError } from "../utils/logger";

const normalizeAddress = (value: string) => value.toLowerCase();

const decodeAmountFromLogData = (data: string): bigint => {
  if (!data.startsWith("0x") || data.length < 66) {
    throw new Error(`Invalid log data: ${data}`);
  }

  return BigInt(`0x${data.slice(2, 66)}`);
};

const decodeIndexedAddress = (topic: string): string => {
  if (!topic.startsWith("0x") || topic.length !== 66) {
    throw new Error(`Invalid topic: ${topic}`);
  }

  return `0x${topic.slice(26)}`.toLowerCase();
};

export const verifyNativeRedemptionsBatch = async (
  deposits: NativeDepositInfo[],
): Promise<Map<string, boolean>> => {
  const results = new Map<string, boolean>();

  if (deposits.length === 0) {
    return results;
  }

  const receipts = await getTransactionReceiptsBatch(
    Number(deposits[0].externalChainId),
    deposits.map((deposit) => deposit.externalTxHash),
  );

  for (const deposit of deposits) {
    try {
      const expectedBridgeAddress = getNativeRepresentationBridgeAddress(
        Number(deposit.externalChainId),
      );
      if (!expectedBridgeAddress) {
        results.set(deposit.externalTxHash, false);
        continue;
      }

      const receipt = receipts.get(deposit.externalTxHash);
      if (!receipt || receipt.status !== "0x1") {
        results.set(deposit.externalTxHash, false);
        continue;
      }

      const matchingLog = receipt.logs.find((log) => {
        if (!log.address || normalizeAddress(log.address) !== normalizeAddress(expectedBridgeAddress)) {
          return false;
        }

        return (
          log.topics.length >= 4 &&
          log.topics[0].toLowerCase() === NATIVE_REDEMPTION_EVENT_SIGNATURE.toLowerCase()
        );
      });

      if (!matchingLog) {
        results.set(deposit.externalTxHash, false);
        continue;
      }

      const representationToken = decodeIndexedAddress(matchingLog.topics[1]);
      const externalSender = decodeIndexedAddress(matchingLog.topics[2]);
      const stratoRecipient = decodeIndexedAddress(matchingLog.topics[3]);
      const amount = decodeAmountFromLogData(matchingLog.data);

      const verified =
        representationToken === normalizeAddress(deposit.representationToken) &&
        externalSender === normalizeAddress(deposit.externalSender) &&
        stratoRecipient === normalizeAddress(deposit.stratoRecipient) &&
        amount === BigInt(deposit.stratoTokenAmount);

      results.set(deposit.externalTxHash, verified);
    } catch (error) {
      logError("NativeVerificationService", error as Error, {
        operation: "verifyNativeRedemptionsBatch",
        externalTxHash: deposit.externalTxHash,
      });
      results.set(deposit.externalTxHash, false);
    }
  }

  return results;
};
