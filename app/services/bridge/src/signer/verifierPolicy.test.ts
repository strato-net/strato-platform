import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateDepositPolicy,
  evaluateWithdrawalPolicy,
  type VerifierPolicy,
} from "./verifierPolicy";
import type { DepositSettlementAttestation } from "./settlementValidation";

const externalToken = "0x1111111111111111111111111111111111111111";
const stratoToken = "2222222222222222222222222222222222222222";

const policy: VerifierPolicy = {
  version: "test-1",
  baselinePolicyHash: `sha256:${"a".repeat(64)}`,
  verifierIndex: 1,
  settlementAttestor: "8888888888888888888888888888888888888888",
  sourceChainId: "9001",
  sourceBridge: "3333333333333333333333333333333333333333",
  destinationChainId: "11155111",
  destinationVault: "0x4444444444444444444444444444444444444444",
  routes: [{
    externalToken,
    stratoToken,
    depositsEnabled: true,
    autoRouteEnabled: false,
    maxAutoDepositAmount: "100",
  }],
  tokens: [{
    token: externalToken,
    withdrawalsEnabled: true,
    maxAutoWithdrawalAmount: "50",
  }],
};

const deposit = {
  externalChainId: "11155111",
  depositRouter: "0x5555555555555555555555555555555555555555",
  depositId: "1",
  externalSender: "0x6666666666666666666666666666666666666666",
  externalToken,
  externalTokenAmount: "100",
  externalTxHash: `0x${"1".repeat(64)}`,
  externalBlockHash: `0x${"2".repeat(64)}`,
  externalLogIndex: 0,
  stratoRecipient: "7777777777777777777777777777777777777777",
  stratoToken,
  action: "0",
  actionToken: "0000000000000000000000000000000000000000",
  minFinalOut: "0",
} satisfies DepositSettlementAttestation;

test("requires local review above the automatic deposit limit", () => {
  assert.equal(evaluateDepositPolicy(policy, deposit).decision, "approve");
  assert.equal(
    evaluateDepositPolicy(policy, {
      ...deposit,
      externalTokenAmount: "101",
    }).decision,
    "manual_review",
  );
});

test("rejects AUTO_ROUTE unless the local route enables it", () => {
  assert.throws(
    () => evaluateDepositPolicy(policy, { ...deposit, action: "4" }),
    /rejects the deposit action/,
  );
});

test("requires local review above the automatic withdrawal limit", () => {
  assert.equal(
    evaluateWithdrawalPolicy(policy, { token: externalToken, amount: "50" })
      .decision,
    "approve",
  );
  assert.equal(
    evaluateWithdrawalPolicy(policy, { token: externalToken, amount: "51" })
      .decision,
    "manual_review",
  );
});
