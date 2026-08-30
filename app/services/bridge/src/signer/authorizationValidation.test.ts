import assert from "node:assert/strict";
import test from "node:test";
import {
  matchesSourceWithdrawalAuthorization,
  validateSignerKmsUrl,
} from "./authorizationValidation";

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

test("requires HTTPS for withdrawal attestation KMS in production", () => {
  assert.throws(
    () => validateSignerKmsUrl("http://attestation-kms", true),
    /must use HTTPS in production/,
  );
  assert.throws(
    () => validateSignerKmsUrl("not-a-url", true),
    /must use HTTPS in production/,
  );
  assert.equal(
    validateSignerKmsUrl("https://attestation-kms", true),
    "https://attestation-kms",
  );
  assert.equal(
    validateSignerKmsUrl("http://localhost:9000", false),
    "http://localhost:9000",
  );
});
