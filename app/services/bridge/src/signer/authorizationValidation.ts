import { AbiCoder, keccak256, toUtf8Bytes } from "ethers";
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

export interface RefundAuthorization extends SourceWithdrawalAuthorization {
  sourceChainId: string;
  sourceBridge: string;
  sourceWithdrawalId: string;
  destinationChainId: string;
  destinationVault: string;
  token: string;
  recipient: string;
  amount: string;
}

export interface RefundWithdrawal {
  stratoSender: string;
  stratoToken: string;
  stratoTokenAmount: string;
  status: string;
  reservationId?: string;
  cancellationTxHash?: string;
}

export const withdrawalRefundDigest = (
  authorization: RefundAuthorization, withdrawal: RefundWithdrawal, verifierSetVersion: string,
): string => {
  const coder = AbiCoder.defaultAbiCoder();
  const address = (value: string) => `0x${value.replace(/^0x/i, "").toLowerCase()}`;
  const hash = (types: string[], values: unknown[]) => keccak256(coder.encode(types, values));
  const withdrawalHash = hash(
    ["uint256", "uint256", "address", "uint256", "address", "address", "address", "uint256"],
    [authorization.sourceWithdrawalId, authorization.destinationChainId, address(authorization.token),
      authorization.amount, address(authorization.recipient), address(withdrawal.stratoSender),
      address(withdrawal.stratoToken), withdrawal.stratoTokenAmount],
  );
  return hash(
    ["bytes32", "uint256", "address", "uint256", "bytes32", "uint8", "uint256", "uint256", "uint256", "address", "bytes32", "bytes32"],
    [keccak256(toUtf8Bytes("EAB_WITHDRAWAL_REFUND_V1")), authorization.sourceChainId,
      address(authorization.sourceBridge), verifierSetVersion, withdrawalHash, withdrawal.status,
      authorization.notBefore, authorization.deadline, authorization.signerSetVersion, address(authorization.destinationVault),
      keccak256(toUtf8Bytes(withdrawal.reservationId || "")),
      keccak256(toUtf8Bytes(withdrawal.cancellationTxHash || ""))],
  );
};

export const depositSettlementDigest = (
  deposit: DepositSettlementAttestation,
  sourceChainId: string, sourceBridge: string, verifierVersion: string, generation: string,
): string => {
  const coder = AbiCoder.defaultAbiCoder();
  const address = (value: string) => `0x${value.replace(/^0x/i, "").toLowerCase()}`;
  const hash = (types: string[], values: unknown[]) => keccak256(coder.encode(types, values));
  const sourceHash = hash(
    ["uint256", "address", "uint256", "address", "address", "uint256", "bytes32"],
    [deposit.externalChainId, address(deposit.depositRouter), deposit.depositId, address(deposit.externalSender),
      address(deposit.externalToken), deposit.externalTokenAmount, keccak256(toUtf8Bytes(`0x${deposit.externalTxHash.replace(/^0x/i, "").toLowerCase()}`))],
  );
  const destinationHash = hash(["address", "address", "uint256", "address", "uint256"],
    [address(deposit.stratoRecipient), address(deposit.stratoToken), deposit.action, address(deposit.actionToken), deposit.minFinalOut]);
  return hash(["bytes32", "uint256", "address", "uint256", "uint256", "bytes32", "bytes32"],
    [keccak256(toUtf8Bytes("EAB_DEPOSIT_SETTLEMENT_V2")), sourceChainId, address(sourceBridge), verifierVersion, generation, sourceHash, destinationHash]);
};
