import { AbiCoder, Contract, getAddress, keccak256 } from "ethers";
import { NativeVerifierPolicy } from "./nativeVerifierPolicy";

export interface NativeMintAttestation {
  sourceChainId: string;
  sourceBridge: string;
  destinationChainId: string;
  destinationBridge: string;
  sourceWithdrawalId: string;
  stratoToken: string;
  representationToken: string;
  recipient: string;
  amount: string;
  notBefore: string;
  deadline: string;
  useInstantPath: boolean;
  signerSetVersion: string;
}

export interface NativeRedemptionRefund {
  sourceChainId: string;
  sourceBridge: string;
  destinationChainId: string;
  destinationBridge: string;
  redemptionId: string;
  representationToken: string;
  recipient: string;
  amount: string;
  deadline: string;
  signerSetVersion: string;
}

type StratoGet = (
  path: string,
  params: Record<string, string>,
) => Promise<{ data?: unknown }>;

const bare = (value: unknown): string =>
  String(value || "").replace(/^0x/i, "").toLowerCase();

const uint = (value: unknown, label: string): string => {
  if (!/^\d+$/.test(String(value ?? ""))) {
    throw new Error(`${label} must be an unsigned integer`);
  }
  return BigInt(String(value)).toString();
};

const bool = (value: unknown): boolean =>
  value === true || String(value).toLowerCase() === "true";

const oneValue = (response: { data?: unknown }, label: string): any => {
  const rows = response.data;
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]?.value) {
    throw new Error(`${label} is unavailable`);
  }
  return rows[0].value;
};

export const validateNativeMintAttestation = async (
  attestation: NativeMintAttestation,
  policy: NativeVerifierPolicy,
  stratoGet: StratoGet,
  bridge: Contract,
  latestTimestamp: bigint,
): Promise<void> => {
  if (
    uint(attestation.sourceChainId, "sourceChainId") !== policy.sourceChainId ||
    bare(attestation.sourceBridge) !== policy.sourceBridge ||
    uint(attestation.destinationChainId, "destinationChainId") !==
      policy.destinationChainId ||
    getAddress(attestation.destinationBridge) !== policy.destinationBridge
  ) {
    throw new Error("Native mint bridge or chain binding mismatch");
  }
  const withdrawalId = uint(attestation.sourceWithdrawalId, "sourceWithdrawalId");
  const withdrawal = oneValue(
    await stratoGet("/cirrus/search/BlockApps-StratoNativeBridge-withdrawals", {
      address: `eq.${policy.sourceBridge}`,
      key: `eq.${withdrawalId}`,
      select: "value",
      limit: "1",
    }),
    "Native withdrawal",
  );
  const useInstantPath = bool(withdrawal.useInstantPath);
  if (
    String(withdrawal.bridgeStatus) !== "2" ||
    uint(withdrawal.externalChainId, "withdrawal.externalChainId") !==
      policy.destinationChainId ||
    bare(withdrawal.externalBridge) !== bare(policy.destinationBridge) ||
    bare(withdrawal.externalRecipient) !== bare(attestation.recipient) ||
    bare(withdrawal.stratoToken) !== bare(attestation.stratoToken) ||
    bare(withdrawal.representationToken) !== bare(attestation.representationToken) ||
    uint(withdrawal.externalTokenAmount, "withdrawal.externalTokenAmount") !==
      uint(attestation.amount, "amount") ||
    uint(withdrawal.nativeMintNotBefore, "withdrawal.nativeMintNotBefore") !==
      uint(attestation.notBefore, "notBefore") ||
    useInstantPath !== attestation.useInstantPath
  ) {
    throw new Error("Native mint attestation does not match the source withdrawal");
  }
  const route = policy.routes.find(
    (candidate) =>
      candidate.stratoToken === bare(attestation.stratoToken) &&
      bare(candidate.representationToken) === bare(attestation.representationToken),
  );
  if (!route) throw new Error("Native verifier policy rejects the token route");
  if (
    useInstantPath &&
    (!route.instantEnabled ||
      BigInt(attestation.amount) > BigInt(route.maxInstantAmount))
  ) {
    throw new Error("Native verifier policy rejects instant execution");
  }
  const notBefore = BigInt(attestation.notBefore);
  const deadline = BigInt(attestation.deadline);
  const maxValidity = BigInt(await bridge.maxAttestationValiditySeconds());
  if (
    latestTimestamp < notBefore ||
    latestTimestamp > deadline ||
    deadline < notBefore ||
    deadline > notBefore + maxValidity
  ) {
    throw new Error("Native mint attestation validity window is invalid");
  }
  const mintId = keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address", "uint256"],
      [attestation.sourceChainId, attestation.sourceBridge, withdrawalId],
    ),
  );
  const [processed, canceled, mappedToken, active, signerSetVersion] = await Promise.all([
    bridge.processedMints(mintId),
    bridge.canceledMints(mintId),
    bridge.stratoToRepresentation(attestation.stratoToken),
    bridge.routeActive(attestation.stratoToken),
    bridge.signerSetVersion(),
  ]);
  if (processed || canceled) throw new Error("Native mint is already settled or canceled");
  if (
    getAddress(mappedToken) !== getAddress(attestation.representationToken) ||
    !active ||
    uint(attestation.signerSetVersion, "signerSetVersion") !==
      BigInt(signerSetVersion).toString()
  ) {
    throw new Error("Native representation route is not active");
  }
};

export const validateNativeRedemptionRefund = async (
  depositId: string,
  refund: NativeRedemptionRefund,
  policy: NativeVerifierPolicy,
  stratoGet: StratoGet,
  bridge: Contract,
  latestTimestamp: bigint,
): Promise<void> => {
  if (
    uint(refund.sourceChainId, "sourceChainId") !== policy.sourceChainId ||
    bare(refund.sourceBridge) !== policy.sourceBridge ||
    uint(refund.destinationChainId, "destinationChainId") !==
      policy.destinationChainId ||
    getAddress(refund.destinationBridge) !== policy.destinationBridge
  ) {
    throw new Error("Native refund bridge or chain binding mismatch");
  }
  const deposit = oneValue(
    await stratoGet("/cirrus/search/BlockApps-StratoNativeBridge-deposits", {
      address: `eq.${policy.sourceBridge}`,
      key: `eq.${depositId}`,
      select: "value",
      limit: "1",
    }),
    "Native deposit",
  );
  if (
    String(deposit.bridgeStatus) !== "7" ||
    uint(deposit.externalChainId, "deposit.externalChainId") !==
      policy.destinationChainId ||
    bare(deposit.externalBridge) !== bare(policy.destinationBridge) ||
    uint(deposit.externalRedemptionId, "deposit.externalRedemptionId") !==
      uint(refund.redemptionId, "redemptionId") ||
    bare(deposit.representationToken) !== bare(refund.representationToken) ||
    bare(deposit.externalSender) !== bare(refund.recipient) ||
    uint(deposit.stratoTokenAmount, "deposit.stratoTokenAmount") !==
      uint(refund.amount, "amount")
  ) {
    throw new Error("Native refund does not match the source deposit");
  }
  const deadline = BigInt(refund.deadline);
  const [maxValidityValue, signerSetVersion] = await Promise.all([
    bridge.maxAttestationValiditySeconds(),
    bridge.signerSetVersion(),
  ]);
  const maxValidity = BigInt(maxValidityValue);
  if (
    deadline < latestTimestamp ||
    deadline > latestTimestamp + maxValidity ||
    uint(refund.signerSetVersion, "signerSetVersion") !==
      BigInt(signerSetVersion).toString()
  ) {
    throw new Error("Native refund deadline is invalid");
  }
  if (await bridge.refundedRedemptions(refund.redemptionId)) {
    throw new Error("Native redemption was already refunded");
  }
};

export const parseNativeSourceRecord = (
  mapping: "withdrawals" | "deposits", key: string, rows: any,
): Record<string, any> => {
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]?.value || typeof rows[0].value !== "object" || Array.isArray(rows[0].value) || String(rows[0].key) !== key) {
    throw new Error(`Native ${mapping === "withdrawals" ? "withdrawal" : "deposit"} is unavailable`);
  }
  return mapping === "withdrawals"
    ? { ...rows[0].value, withdrawalId: key }
    : rows[0].value;
};
