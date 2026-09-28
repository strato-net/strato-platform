import { Interface } from "ethers";
import { getTransactionReceiptsBatch } from "./rpcService";
import {
  getNativeRepresentationBridgeAddress,
  NATIVE_REDEMPTION_EVENT_SIGNATURES,
} from "../config";
import { NATIVE_REDEMPTION_EVENTS_ABI } from "../polling/nativeRedemptionPolling";
import { NativeDepositInfo } from "../types";
import { logError } from "../utils/logger";

const redemptionEvents = new Interface(NATIVE_REDEMPTION_EVENTS_ABI);

const normalizeAddress = (value: string) =>
  value.toLowerCase().replace(/^0x/, "");

/// Decoded by ABI, not by slicing: the fee-bearing variant appends three words,
/// and reading a fixed two out of five would misverify every such redemption.
const decodeNativeRedemption = (
  log: { topics: string[]; data: string },
): { amount: bigint; redemptionId: bigint } => {
  const parsed = redemptionEvents.parseLog({ topics: log.topics, data: log.data });
  if (!parsed) {
    throw new Error("Log does not match a supported redemption event");
  }
  return {
    amount: BigInt(parsed.args.amount.toString()),
    redemptionId: BigInt(parsed.args.redemptionId.toString()),
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
            NATIVE_REDEMPTION_EVENT_SIGNATURES.some(
              (signature) => log.topics[0].toLowerCase() === signature.toLowerCase(),
            )
          );
        });

        if (!matchingLog) {
          results.set(deposit.depositId, false);
          continue;
        }

        const representationToken = normalizeAddress(decodeIndexedAddress(matchingLog.topics[1]));
        const externalSender = normalizeAddress(decodeIndexedAddress(matchingLog.topics[2]));
        const stratoRecipient = normalizeAddress(decodeIndexedAddress(matchingLog.topics[3]));
        const { amount, redemptionId } = decodeNativeRedemption(matchingLog);

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
