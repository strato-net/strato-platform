import assert from "node:assert/strict";
import test from "node:test";
import { matchesSourceWithdrawalAuthorization } from "./authorizationValidation";

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
