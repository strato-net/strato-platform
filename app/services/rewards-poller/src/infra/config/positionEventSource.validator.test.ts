import assert from "node:assert/strict";
import test from "node:test";
import { parsePositionEventSources } from "./positionEventSource.validator";

const custodyVault = "1111111111111111111111111111111111111111";
const rawSource = {
  sourceContract: `0x${custodyVault}`,
  targetActivitySourceAttribute: "token",
  events: {
    Locked: {
      action: "Withdraw",
      userAttribute: "from",
      amountAttribute: "amount",
    },
  },
};

test("normalizes and validates configured position event sources", () => {
  const sources = parsePositionEventSources([rawSource]);

  assert.deepEqual(sources, [{
    ...rawSource,
    sourceContract: custodyVault,
  }]);
});

test("rejects invalid source addresses", () => {
  assert.throws(
    () => parsePositionEventSources([{ ...rawSource, sourceContract: "invalid" }]),
    /Invalid position event sourceContract/
  );
});

test("rejects duplicate source and event mappings", () => {
  assert.throws(
    () => parsePositionEventSources([rawSource, rawSource]),
    /Duplicate position event source mapping/
  );
});

test("rejects unsupported position actions", () => {
  assert.throws(
    () => parsePositionEventSources([{
        ...rawSource,
        events: {
          Locked: {
            ...rawSource.events.Locked,
            action: "Occurred",
          },
        },
      }]),
    /must be Deposit or Withdraw/
  );
});
