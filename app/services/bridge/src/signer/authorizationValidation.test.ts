import assert from "node:assert/strict";
import test from "node:test";
import { withdrawalRefundDigest, matchesSourceWithdrawalAuthorization } from "./authorizationValidation";

const requested = {
  notBefore: "100",
  deadline: "200",
  signerSetVersion: "3",
};

test("requires exact STRATO withdrawal authorization timing and version", () => {
  assert.equal(
    matchesSourceWithdrawalAuthorization({ ...requested }, requested),
    true,
  );
  assert.equal(
    matchesSourceWithdrawalAuthorization(
      { ...requested, deadline: "201" },
      requested,
    ),
    false,
  );
  assert.equal(
    matchesSourceWithdrawalAuthorization(
      { ...requested, signerSetVersion: "4" },
      requested,
    ),
    false,
  );
  assert.equal(matchesSourceWithdrawalAuthorization(undefined, requested), false);
});

test("refund digest binds all mutable source refund fields", () => {
  const authorization = { ...requested, sourceChainId: "114784819836269", sourceBridge: "1".repeat(40),
    sourceWithdrawalId: "1", destinationChainId: "11155111", destinationVault: "2".repeat(40),
    token: "3".repeat(40), recipient: "4".repeat(40), amount: "100" };
  const withdrawal = { stratoSender: "5".repeat(40), stratoToken: "6".repeat(40), stratoTokenAmount: "100000000000000",
    status: "3", reservationId: "0xaaaa", cancellationTxHash: "0xbbbb" };
  const digest = withdrawalRefundDigest(authorization, withdrawal, "7");
  for (const [key, value] of Object.entries({ status: "5", reservationId: "0xcccc", cancellationTxHash: "0xdddd", stratoTokenAmount: "101" })) {
    assert.notEqual(withdrawalRefundDigest(authorization, { ...withdrawal, [key]: value }, "7"), digest);
  }
  assert.notEqual(withdrawalRefundDigest(authorization, withdrawal, "8"), digest);
  assert.throws(() => withdrawalRefundDigest(authorization, withdrawal, undefined as any));
});
