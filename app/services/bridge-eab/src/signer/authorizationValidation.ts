import { Interface } from "ethers";
import { BRIDGE_DIGEST_ABI } from "../config/bridgeAbi";
import type { DepositSettlementAttestation } from "./settlementValidation";

export interface SourceWithdrawalAuthorization {
  notBefore: string;
  deadline: string;
  signerSetVersion: string;
}

export const matchesSourceWithdrawalAuthorization = (
  source: Partial<SourceWithdrawalAuthorization> | undefined,
  requested: SourceWithdrawalAuthorization,
): boolean => {
  try {
    return (
      source != null &&
      BigInt(source.notBefore!) === BigInt(requested.notBefore) &&
      BigInt(source.deadline!) === BigInt(requested.deadline) &&
      BigInt(source.signerSetVersion!) === BigInt(requested.signerSetVersion)
    );
  } catch {
    return false;
  }
};

// Read digests from SolidVM instead of reproducing its runtime ABI encoding in ethers.
export const buildBridgeDigestRequest = (sourceBridge: string, method: string, args: unknown[], abi: readonly string[] = BRIDGE_DIGEST_ABI) => ({
  jsonrpc: "2.0", id: 1, method: "eth_call",
  params: [{ to: `0x${sourceBridge.replace(/^0x/i, "")}`,
    data: new Interface(abi).encodeFunctionData(method, args) }, "latest"],
});

export const depositDigestArgs = (deposit: DepositSettlementAttestation): unknown[] => {
  const address = (value: string) => `0x${value.replace(/^0x/i, "").toLowerCase()}`;
  return [deposit.externalChainId, address(deposit.depositRouter), deposit.depositId,
    address(deposit.externalSender), address(deposit.externalToken), deposit.externalTokenAmount,
    `0x${deposit.externalTxHash.replace(/^0x/i, "").toLowerCase()}`, address(deposit.stratoRecipient),
    address(deposit.stratoToken), deposit.action, address(deposit.actionToken), deposit.minFinalOut];
};

export const parseBridgeDigest = (response: any): string => {
  if (response?.error || !/^0x[0-9a-f]{64}$/i.test(response?.result || "")) {
    throw new Error("Unable to read bridge digest from STRATO");
  }
  return response.result.toLowerCase();
};
