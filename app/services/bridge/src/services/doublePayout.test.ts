import "../test/setupEnv";
import assert from "node:assert/strict";
import test from "node:test";
import { config } from "../config";
import { FunctionInput, NativeWithdrawalInfo } from "../types";
import { eth } from "../utils/api";
import * as logger from "../utils/logger";
import * as stratoHelper from "../utils/stratoHelper";
import * as nativeMintService from "./nativeMintService";
import { queueManualNativeWithdrawalBatch } from "./bridgeService";
import { checkSafeTxStatus, isSafeRejection } from "./safeService";

const SAFE = "0x8c458f866e603335ef179a63a2528f357732f5d5";
const RECIPIENT = "0x2222222222222222222222222222222222222222";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const word = (hex: string) => hex.replace(/^0x/, "").padStart(64, "0");
const erc20Transfer = (recipient: string, amount: bigint) => `0xa9059cbb${word(recipient)}${word(amount.toString(16))}`;

const ethPayout = { to: RECIPIENT, value: "1000", data: null, operation: 0 };
const usdcPayout = { to: USDC, value: "0", data: erc20Transfer(RECIPIENT, 5_000_000n), operation: 0 };
const safeRejection = { to: SAFE, value: "0", data: null, operation: 0, isSuccessful: true };
const multiSend = {
  to: "0x40a2accbd92bca938b02010e17a5b8929b49130d",
  value: "0",
  data: "0x8d80ff0a",
  operation: 1,
  isSuccessful: true,
};

test("only an empty, successful call to the Safe itself is a Safe rejection", () => {
  assert.equal(isSafeRejection(safeRejection, SAFE), true);
  assert.equal(isSafeRejection({ ...safeRejection, data: "0x" }, SAFE.toUpperCase().replace("0X", "0x")), true);

  assert.equal(isSafeRejection({ ...ethPayout, isSuccessful: true }, SAFE), false);
  assert.equal(isSafeRejection({ ...usdcPayout, isSuccessful: true }, SAFE), false);
  assert.equal(isSafeRejection(multiSend, SAFE), false);
  assert.equal(isSafeRejection({ ...safeRejection, value: "1" }, SAFE), false);
  assert.equal(isSafeRejection({ ...safeRejection, data: "0xa9059cbb" }, SAFE), false);
  assert.equal(isSafeRejection({ ...safeRejection, operation: 1 }, SAFE), false);
  assert.equal(isSafeRejection({ ...safeRejection, isSuccessful: false }, SAFE), false);
});

// The status of a payout whose nonce was taken by `replacement`
const statusAfter = (replacement: any) => {
  const original = { ...ethPayout, safeTxHash: `0x${"aa".repeat(32)}`, nonce: 70, isExecuted: false, safe: SAFE };
  const apiKit: any = {
    getTransaction: async () => original,
    getMultisigTransactions: async () => ({
      results: [original, { ...replacement, safeTxHash: `0x${"bb".repeat(32)}`, nonce: 70, isExecuted: true }],
    }),
  };
  return checkSafeTxStatus(original.safeTxHash, apiKit);
};

test("a payout replaced by a Safe rejection is rejected, so it is refunded", async () => {
  assert.equal(await statusAfter(safeRejection), "rejected");
});

test("a payout replaced by anything else is never refunded automatically", async () => {
  assert.equal(await statusAfter({ ...ethPayout, isSuccessful: true }), "pending");
  assert.equal(await statusAfter({ ...ethPayout, value: "999", isSuccessful: true }), "pending");
  assert.equal(await statusAfter({ ...usdcPayout, isSuccessful: true }), "pending");
  assert.equal(await statusAfter(multiSend), "pending");
  assert.equal(await statusAfter({ ...ethPayout, isSuccessful: false }), "pending");
});

const nativeWithdrawal: NativeWithdrawalInfo = {
  bridgeStatus: "2",
  externalTxHash: "",
  externalChainId: 1,
  externalBridge: "0x991513a7fb8793fc75955821bbef488f0aa0712f",
  externalRecipient: RECIPIENT,
  representationToken: "0x4c93b9fbf7fd1777ccbcbc538b1d0a8b58fb1ad6",
  externalTokenAmount: "1000",
  requestedAt: "0",
  stratoSender: "0x3333333333333333333333333333333333333333",
  stratoToken: "0x2ca3e170e6714282da77815f7864b17f612f5f83",
  stratoTokenAmount: "1000",
  timestamp: "0",
  nativeMintProposalHash: `0x${"cc".repeat(32)}`,
  useInstantPath: false,
  withdrawalId: "7",
};

// What the relayer does on STRATO, and whether it searched for a mint, after a rejected manual mint proposal
const afterRejectedNativeProposal = async (withdrawal = nativeWithdrawal): Promise<{ executed: FunctionInput[]; mintLookups: number }> => {
  const executed: FunctionInput[] = [];
  let mintLookups = 0;
  const originals = {
    execute: stratoHelper.execute,
    get: (eth as any).get,
    execution: nativeMintService.getNativeMintProposalExecution,
    existing: nativeMintService.getExistingNativeMintTxHash,
    bridge: config.nativeBridge.address,
  };
  config.nativeBridge.address = "0x4d9e9c39180a75091b9c35bbb9064d67c7fdde5a";
  (eth as any).get = async () => ({ networkID: 1 });
  (stratoHelper as any).execute = async (input: FunctionInput) => {
    executed.push(input);
    return { status: "Success", hash: "0xstrato" };
  };
  (nativeMintService as any).getNativeMintProposalExecution = async () => ({ status: "rejected" });
  (nativeMintService as any).getExistingNativeMintTxHash = async () => {
    mintLookups++;
    return null;
  };
  try {
    await queueManualNativeWithdrawalBatch([withdrawal]);
  } finally {
    (stratoHelper as any).execute = originals.execute;
    (eth as any).get = originals.get;
    (nativeMintService as any).getNativeMintProposalExecution = originals.execution;
    (nativeMintService as any).getExistingNativeMintTxHash = originals.existing;
    config.nativeBridge.address = originals.bridge;
  }
  return { executed, mintLookups };
};

test("a rejected native mint proposal is left for a person: no refund, no finalize, no chain scan", async () => {
  assert.deepEqual(await afterRejectedNativeProposal(), { executed: [], mintLookups: 0 });
});

test("a withdrawal left for manual resolution is reported once, not on every poll", async () => {
  const originalLogError = logger.logError;
  const reported: string[] = [];
  (logger as any).logError = (_context: string, error: Error) => reported.push(error.message);
  try {
    const replaced = { ...multiSend, safeTxHash: `0x${"ee".repeat(32)}`, nonce: 71, isExecuted: true };
    const original = { ...ethPayout, safeTxHash: `0x${"ef".repeat(32)}`, nonce: 71, isExecuted: false, safe: SAFE };
    const apiKit: any = {
      getTransaction: async () => original,
      getMultisigTransactions: async () => ({ results: [original, replaced] }),
    };
    const repeatedNative = { ...nativeWithdrawal, withdrawalId: "8" };
    for (let poll = 0; poll < 3; poll++) {
      assert.equal(await checkSafeTxStatus(original.safeTxHash, apiKit), "pending");
      await afterRejectedNativeProposal(repeatedNative);
    }
    assert.equal(reported.filter((m) => m.includes(original.safeTxHash)).length, 1);
    assert.equal(reported.filter((m) => m.includes("Native withdrawal 8 ")).length, 1);
  } finally {
    (logger as any).logError = originalLogError;
  }
});
