import assert from "node:assert/strict";
import test from "node:test";
import { applyDepositActionOutcomes } from "../helpers/events.helper";

const event = (index: number, name: string, attributes = {}): any => ({
  address: "bridge", transaction_hash: "settlement", event_index: index,
  event_name: name, attributes: {
    externalChainId: "1", externalTxHash: "external", recipient: "user",
    stratoRecipient: "user", ...attributes,
  },
});

test("matches separate routed, fallback and plain deposits in one transaction", () => {
  const routed = event(1, "DepositCompleted");
  const fallback = event(3, "DepositCompleted");
  const plain = event(4, "DepositCompleted");
  const history = [
    event(0, "AutoRouted", { finalToken: "route", finalAmount: "42" }), routed,
    event(2, "DepositActionFallback", { fallbackToken: "source", fallbackAmount: "100" }), fallback, plain,
  ];
  applyDepositActionOutcomes([routed, fallback, plain], history.reverse());
  assert.equal(routed.depositOutcome, "route");
  assert.equal(routed.finalAmount, "42");
  assert.equal(fallback.depositOutcome, "fallback");
  assert.equal(fallback.finalToken, "source");
  assert.equal(plain.depositOutcome, undefined);
});

test("pagination does not reuse an earlier deposit outcome", () => {
  const plain = event(2, "DepositCompleted");
  applyDepositActionOutcomes([plain], [event(0, "AutoRouted"), event(1, "DepositCompleted"), plain]);
  assert.equal(plain.depositOutcome, undefined);
});

test("rejects mismatched identity, contract and ambiguous event ordering", () => {
  for (const outcome of [
    event(0, "AutoRouted", { externalTxHash: "different" }),
    { ...event(0, "AutoRouted"), address: "other" },
    event(1, "AutoRouted"),
    { ...event(0, "AutoRouted"), event_index: undefined },
  ]) {
    const completion = event(1, "DepositCompleted");
    applyDepositActionOutcomes([completion], [outcome, completion]);
    assert.equal(completion.depositOutcome, undefined);
  }
});
