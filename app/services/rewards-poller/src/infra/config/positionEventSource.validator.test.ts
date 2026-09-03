import assert from "node:assert/strict";
import test from "node:test";
import { parsePositionEventSources } from "./positionEventSource.validator";

const custodyVault = "1111111111111111111111111111111111111111";
const rawSource = {
  sourceContract: "${CUSTODY_VAULT}",
  targetActivitySourceAttribute: "token",
  events: {
    Locked: {
      action: "Withdraw",
      userAttribute: "from",
      amountAttribute: "amount",
    },
  },
};

test("resolves and validates configured position event sources", () => {
  const sources = parsePositionEventSources(
    [rawSource],
    (name) => name === "CUSTODY_VAULT" ? `0x${custodyVault}` : undefined
  );

  assert.deepEqual(sources, [{
    ...rawSource,
    sourceContract: custodyVault,
  }]);
});

test("rejects missing source environment variables", () => {
  assert.throws(
    () => parsePositionEventSources([rawSource], () => undefined),
    /environment variable CUSTODY_VAULT is required/
  );
});

test("rejects duplicate source and event mappings", () => {
  assert.throws(
    () => parsePositionEventSources(
      [rawSource, rawSource],
      () => custodyVault
    ),
    /Duplicate position event source mapping/
  );
});

test("rejects unsupported position actions", () => {
  assert.throws(
    () => parsePositionEventSources(
      [{
        ...rawSource,
        events: {
          Locked: {
            ...rawSource.events.Locked,
            action: "Occurred",
          },
        },
      }],
      () => custodyVault
    ),
    /must be Deposit or Withdraw/
  );
});
