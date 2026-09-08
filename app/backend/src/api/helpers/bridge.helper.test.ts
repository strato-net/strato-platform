import assert from "node:assert/strict";
import test from "node:test";
import { Event } from "@strato/shared-types";
import { cirrus } from "../../utils/appApiHelper";
import { enrichDepositCompletedActivities } from "./bridge.helper";

test("enriches one deposit activity with its routed final output", async () => {
  const originalGet = cirrus.get;
  cirrus.get = (async (_accessToken: string, path: string) => {
    if (path === "/event") {
      return {
        data: [{
          event_name: "AutoRouted",
          attributes: {
            externalTxHash: "abc123",
            finalToken: "0000000000000000000000000000000000001234",
            finalAmount: "25000000000000000000",
          },
        }],
      };
    }
    if (path === "/storage") {
      return {
        data: [{
          address: "0000000000000000000000000000000000001234",
          _name: "Yield Token",
          _symbol: "YIELD",
        }],
      };
    }
    return { data: [] };
  }) as typeof cirrus.get;

  const deposit = {
    id: 1,
    address: "bridge",
    block_hash: "block",
    block_timestamp: "2026-08-17T00:00:00.000Z",
    block_number: "1",
    transaction_sender: "relayer",
    event_index: 0,
    contract_name: "MercataBridge",
    event_name: "DepositCompleted",
    attributes: { externalTxHash: "abc123" },
  } satisfies Event;

  try {
    const result = await enrichDepositCompletedActivities("token", [deposit]);
    assert.equal(result.length, 1);
    assert.equal(result[0].depositOutcome, "route");
    assert.equal(result[0].finalToken, "0000000000000000000000000000000000001234");
    assert.equal(result[0].finalAmount, "25000000000000000000");
    assert.equal(result[0].finalTokenSymbol, "YIELD");
  } finally {
    cirrus.get = originalGet;
  }
});
