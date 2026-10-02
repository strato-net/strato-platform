const assert = require("node:assert/strict");
const test = require("node:test");
const { buildPlan, parseArgs } = require("./configure-native-route");

const baseArgs = {
  "bridge-address": "1".repeat(40),
  "external-chain-id": "11155111",
  "external-bridge": "2".repeat(40),
  "representation-token": "3".repeat(40),
  "external-name": "Wrapped STRATO",
  "external-symbol": "STRATO",
  "max-per-withdrawal": "1000",
  "instant-withdrawal-threshold": "100",
  "strato-token": "4".repeat(40),
};

test("builds AdminRegistry calls with verifier quorum before route activation", () => {
  const plan = buildPlan({
    ...baseArgs,
    "settlement-verifiers": ["5", "6", "7"].map((value) => value.repeat(40)).join(","),
    "settlement-verifier-threshold": "2",
  });

  assert.deepEqual(
    plan.calls.map((call) => call.args._func),
    [
      "setSettlementVerifier",
      "setSettlementVerifier",
      "setSettlementVerifier",
      "setSettlementVerifierThreshold",
      "setAsset",
    ],
  );
  assert.ok(plan.calls.every((call) => call.method === "castVoteOnIssue"));
  assert.equal(plan.calls[3].args._args[0].value, "2");
});

test("rejects an unsafe settlement verifier threshold", () => {
  assert.throws(
    () => buildPlan({
      ...baseArgs,
      "settlement-verifiers": `${"5".repeat(40)},${"6".repeat(40)}`,
      "settlement-verifier-threshold": "1",
    }),
    /threshold must be between 2/,
  );
});

test("requires verifier addresses and threshold together", () => {
  assert.throws(
    () => buildPlan({
      ...baseArgs,
      "settlement-verifiers": `${"5".repeat(40)},${"6".repeat(40)}`,
    }),
    /must be provided together/,
  );
});

test("parses execute without consuming the next option", () => {
  assert.deepEqual(
    parseArgs(["--execute", "--bridge-address", "1".repeat(40)]),
    { execute: true, "bridge-address": "1".repeat(40) },
  );
});
