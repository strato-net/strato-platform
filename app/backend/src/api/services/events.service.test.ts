import assert from "node:assert/strict";
import test from "node:test";
import { applyDepositActionOutcomes } from "../helpers/events.helper";

test("enriches only the matching routed deposit completion", () => {
  const events: any[] = [
    {
      transaction_hash: "0xsettlement",
      event_name: "DepositCompleted",
    },
    {
      transaction_hash: "0xsettlement",
      event_name: "WithdrawalCompleted",
    },
  ];

  applyDepositActionOutcomes(events, [
    {
      transaction_hash: "0xsettlement",
      event_name: "AutoRouted",
      attributes: {
        finalToken: "0xfinal",
        finalAmount: "42",
      },
    },
  ]);

  assert.deepEqual(events[0], {
    transaction_hash: "0xsettlement",
    event_name: "DepositCompleted",
    depositOutcome: "route",
    finalToken: "0xfinal",
    finalAmount: "42",
  });
  assert.deepEqual(events[1], {
    transaction_hash: "0xsettlement",
    event_name: "WithdrawalCompleted",
  });
});

test("enriches source-token fallback completion", () => {
  const events: any[] = [
    {
      transaction_hash: "0xfallback",
      event_name: "DepositCompleted",
    },
  ];

  applyDepositActionOutcomes(events, [
    {
      transaction_hash: "0xfallback",
      event_name: "DepositActionFallback",
      attributes: {
        fallbackToken: "0xsource",
        fallbackAmount: "100",
      },
    },
  ]);

  assert.equal(events[0].depositOutcome, "fallback");
  assert.equal(events[0].finalToken, "0xsource");
  assert.equal(events[0].finalAmount, "100");
});
