import { getTransactionReceiptsBatch } from "./rpcService";
import { getNativeRepresentationBridgeAddress, ZERO_ADDRESS } from "../config";
import { NativeDepositInfo } from "../types";
import { parseNativeDepositLog } from "../utils/nativeRedemption";
import { logError } from "../utils/logger";

const normalizeAddress = (value: string) =>
  value.toLowerCase().replace(/^0x/, "");

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

        const verified = receipt.logs.some((log) => {
          if (!log.address || normalizeAddress(log.address) !== normalizeAddress(expectedBridgeAddress)) return false;
          const event = parseNativeDepositLog(externalChainId, { ...log, transactionHash: deposit.externalTxHash });
          return event !== null &&
            normalizeAddress(event.externalBridge) === normalizeAddress(deposit.externalBridge) &&
            normalizeAddress(event.representationToken) === normalizeAddress(deposit.representationToken) &&
            normalizeAddress(event.externalSender) === normalizeAddress(deposit.externalSender) &&
            normalizeAddress(event.stratoRecipient) === normalizeAddress(deposit.stratoRecipient) &&
            BigInt(event.stratoTokenAmount) === BigInt(deposit.stratoTokenAmount) &&
            BigInt(event.externalRedemptionId) === BigInt(deposit.externalRedemptionId) &&
            normalizeAddress(event.actionToken!) === normalizeAddress(deposit.actionToken || ZERO_ADDRESS) &&
            BigInt(event.minFinalOut!) === BigInt(deposit.minFinalOut || "0");
        });

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
