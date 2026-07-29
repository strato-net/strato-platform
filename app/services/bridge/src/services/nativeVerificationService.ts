import { getTransactionReceiptsBatch } from "./rpcService";
import { getNativeRepresentationBridgeAddress, NATIVE_REDEMPTION_EVENT_SIGNATURE } from "../config";
import { NativeDepositInfo } from "../types";
import { logError } from "../utils/logger";

const normalizeAddress = (value: string) =>
  value.toLowerCase().replace(/^0x/, "");

const decodeNativeRedemptionData = (
  data: string,
): { amount: bigint; redemptionId: bigint } => {
  if (!data.startsWith("0x") || data.length < 130) {
    throw new Error(`Invalid log data: ${data}`);
  }

  return {
    amount: BigInt(`0x${data.slice(2, 66)}`),
    redemptionId: BigInt(`0x${data.slice(66, 130)}`),
  };
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

  const depositsByChain = new Map<number, NativeDepositInfo[]>();
  for (const deposit of deposits) {
    const externalChainId = Number(deposit.externalChainId);
    const chainDeposits = depositsByChain.get(externalChainId) || [];
    chainDeposits.push(deposit);
    depositsByChain.set(externalChainId, chainDeposits);
  }

  for (const [externalChainId, chainDeposits] of depositsByChain) {
    const receipts = await getTransactionReceiptsBatch(
      externalChainId,
      [...new Set(chainDeposits.map((deposit) => deposit.externalTxHash))],
    );

    for (const deposit of chainDeposits) {
      try {
        const expectedBridgeAddress = getNativeRepresentationBridgeAddress(
          externalChainId,
        );
        if (!expectedBridgeAddress) {
          results.set(deposit.depositId, false);
          continue;
        }

        const receipt = receipts.get(deposit.externalTxHash);
        if (!receipt || receipt.status !== "0x1") {
          results.set(deposit.depositId, false);
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
          results.set(deposit.depositId, false);
          continue;
        }

        const representationToken = normalizeAddress(decodeIndexedAddress(matchingLog.topics[1]));
        const externalSender = normalizeAddress(decodeIndexedAddress(matchingLog.topics[2]));
        const stratoRecipient = normalizeAddress(decodeIndexedAddress(matchingLog.topics[3]));
        const { amount, redemptionId } = decodeNativeRedemptionData(matchingLog.data);

        const verified =
          normalizeAddress(matchingLog.address) === normalizeAddress(deposit.externalBridge) &&
          representationToken === normalizeAddress(deposit.representationToken) &&
          externalSender === normalizeAddress(deposit.externalSender) &&
          stratoRecipient === normalizeAddress(deposit.stratoRecipient) &&
          amount === BigInt(deposit.stratoTokenAmount) &&
          redemptionId === BigInt(deposit.externalRedemptionId);

        results.set(deposit.depositId, verified);
      } catch (error) {
        logError("NativeVerificationService", error as Error, {
          operation: "verifyNativeRedemptionsBatch",
          externalTxHash: deposit.externalTxHash,
        });
        results.set(deposit.depositId, false);
      }
    }
  }

  return results;
};
