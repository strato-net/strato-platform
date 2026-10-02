import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Contract } from "ethers";
import {
  NativeMintAttestation,
  NativeRedemptionRefund,
  validateNativeMintAttestation,
  validateNativeRedemptionRefund,
} from "./nativeAttestationValidation";
import {
  loadNativeVerifierPolicy,
  NativeVerifierPolicy,
} from "./nativeVerifierPolicy";

const sourceBridge = "22".repeat(20);
const stratoToken = "11".repeat(20);
const representationToken = `0x${"33".repeat(20)}`;
const destinationBridge = `0x${"44".repeat(20)}`;
const recipient = `0x${"66".repeat(20)}`;

const policy: NativeVerifierPolicy = {
  version: "test-1",
  baselinePolicyHash: `sha256:${"a".repeat(64)}`,
  verifierIndex: 1,
  sourceChainId: "9001",
  sourceBridge,
  destinationChainId: "11155111",
  destinationBridge,
  routes: [{
    stratoToken,
    representationToken,
    instantEnabled: true,
    maxInstantAmount: "100",
  }],
};

const mint: NativeMintAttestation = {
  sourceChainId: policy.sourceChainId,
  sourceBridge: `0x${sourceBridge}`,
  destinationChainId: policy.destinationChainId,
  destinationBridge,
  sourceWithdrawalId: "7",
  stratoToken: `0x${stratoToken}`,
  representationToken,
  recipient,
  amount: "100",
  notBefore: "1000",
  deadline: "1100",
  useInstantPath: true,
  maxFee: "10",
  requestedAt: "900",
  feeHalfLife: "60",
  signerSetVersion: "3",
};
const withdrawal = {
  bridgeStatus: "2",
  externalChainId: policy.destinationChainId,
  externalBridge: destinationBridge,
  externalRecipient: recipient,
  stratoToken,
  representationToken,
  externalTokenAmount: "100",
  nativeMintNotBefore: "1000",
  useInstantPath: true,
};
const feeTerms = { set: true, maxFee: "10", requestedAt: "900", feeHalfLife: "60" };
const deposit = {
  bridgeStatus: "7",
  externalChainId: policy.destinationChainId,
  externalBridge: destinationBridge,
  externalRedemptionId: "9",
  representationToken,
  externalSender: recipient,
  stratoTokenAmount: "100",
};
const stratoGet = async (path: string, _params: Record<string, string>) => ({
  data: [{
    value: path.endsWith("withdrawalFeeTerms")
      ? feeTerms
      : path.endsWith("deposits") ? deposit : withdrawal,
  }],
});
const bridge = {
  maxAttestationValiditySeconds: async () => 300n,
  processedMints: async () => false,
  canceledMints: async () => false,
  stratoToRepresentation: async () => representationToken,
  routeActive: async () => true,
  refundedRedemptions: async () => false,
  signerSetVersion: async () => 3n,
} as unknown as Contract;

test("native policy baseline binds routes and bridge identity", () => {
  const baseline = {
    version: policy.version,
    sourceChainId: policy.sourceChainId,
    sourceBridge,
    destinationChainId: policy.destinationChainId,
    destinationBridge,
    routes: policy.routes,
  };
  const input = {
    ...baseline,
    verifierIndex: 1,
    baselinePolicyHash: `sha256:${createHash("sha256").update(JSON.stringify(baseline)).digest("hex")}`,
  };
  const directory = mkdtempSync(join(tmpdir(), "native-policy-"));
  const file = join(directory, "policy.json");
  try {
    writeFileSync(file, JSON.stringify(input));
    assert.equal(loadNativeVerifierPolicy(file).policy.destinationBridge, destinationBridge);
    writeFileSync(file, JSON.stringify({
      ...input,
      routes: [{ ...input.routes[0], maxInstantAmount: "101" }],
    }));
    assert.throws(() => loadNativeVerifierPolicy(file), /baseline policy hash/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("native mint validation binds source state, fee terms, lane, and instant cap", async () => {
  await validateNativeMintAttestation(mint, policy, stratoGet, bridge, 1050n);
  await assert.rejects(
    validateNativeMintAttestation(
      { ...mint, useInstantPath: false },
      policy,
      stratoGet,
      bridge,
      1050n,
    ),
    /source withdrawal/,
  );
  await assert.rejects(
    validateNativeMintAttestation(
      mint,
      { ...policy, routes: [{ ...policy.routes[0], maxInstantAmount: "99" }] },
      stratoGet,
      bridge,
      1050n,
    ),
    /instant execution/,
  );
  await assert.rejects(
    validateNativeMintAttestation(
      { ...mint, maxFee: "11" },
      policy,
      stratoGet,
      bridge,
      1050n,
    ),
    /fee terms/,
  );
  await assert.rejects(
    validateNativeMintAttestation(mint, policy, stratoGet, bridge, 999n),
    /validity window/,
  );
});

test("native refund validation binds the aborted deposit and unused redemption", async () => {
  const refund: NativeRedemptionRefund = {
    sourceChainId: policy.sourceChainId,
    sourceBridge: `0x${sourceBridge}`,
    destinationChainId: policy.destinationChainId,
    destinationBridge,
    redemptionId: "9",
    representationToken,
    recipient,
    amount: "100",
    deadline: "1100",
    signerSetVersion: "3",
  };
  await validateNativeRedemptionRefund("7", refund, policy, stratoGet, bridge, 1000n);
  await assert.rejects(
    validateNativeRedemptionRefund(
      "7",
      { ...refund, amount: "101" },
      policy,
      stratoGet,
      bridge,
      1000n,
    ),
    /source deposit/,
  );
  await assert.rejects(
    validateNativeRedemptionRefund(
      "7",
      refund,
      policy,
      stratoGet,
      { ...bridge, refundedRedemptions: async () => true } as unknown as Contract,
      1000n,
    ),
    /already refunded/,
  );
});
