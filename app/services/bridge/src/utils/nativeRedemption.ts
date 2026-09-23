import { NATIVE_REDEMPTION_EVENT_SIGNATURE, NATIVE_ROUTED_REDEMPTION_EVENT_SIGNATURE, ZERO_ADDRESS } from "../config";
import { NativeDepositArgs } from "../types";

export const parseNativeDepositLog = (chainId: number, log: any): NativeDepositArgs | null => {
  const signature = log.topics?.[0]?.toLowerCase();
  const routed = signature === NATIVE_ROUTED_REDEMPTION_EVENT_SIGNATURE.toLowerCase();
  if (!routed && signature !== NATIVE_REDEMPTION_EVENT_SIGNATURE.toLowerCase()) return null;
  if (!log.transactionHash || log.topics.length !== 4 ||
      !log.topics.every((topic: string) => /^0x[0-9a-f]{64}$/i.test(topic)) ||
      !new RegExp(`^0x[0-9a-f]{${routed ? 256 : 128}}$`, "i").test(log.data)) {
    throw new Error("Invalid native redemption log");
  }
  const word = (index: number) => log.data.slice(2 + index * 64, 66 + index * 64);
  const actionToken = routed ? `0x${word(2).slice(24)}`.toLowerCase() : ZERO_ADDRESS;
  const minFinalOut = routed ? BigInt(`0x${word(3)}`).toString() : "0";
  if (routed && (actionToken === ZERO_ADDRESS || BigInt(minFinalOut) === 0n)) {
    throw new Error("Invalid native route intent");
  }
  return {
    externalChainId: chainId,
    externalBridge: log.address.toLowerCase(),
    externalRedemptionId: BigInt(`0x${word(1)}`).toString(),
    externalSender: `0x${log.topics[2].slice(26)}`.toLowerCase(),
    representationToken: `0x${log.topics[1].slice(26)}`.toLowerCase(),
    externalTxHash: log.transactionHash,
    stratoRecipient: `0x${log.topics[3].slice(26)}`.toLowerCase(),
    stratoTokenAmount: BigInt(`0x${word(0)}`).toString(),
    actionToken,
    minFinalOut,
  };
};
