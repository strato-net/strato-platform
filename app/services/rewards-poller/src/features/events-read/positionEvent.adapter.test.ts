import assert from "node:assert/strict";
import test from "node:test";
import { CirrusEvent, PositionEventSource } from "../../shared/types";
import {
  addPositionActivityRoute,
  mapPositionSourceEvent,
} from "./positionEvent.adapter";

const custodyVault = "1111111111111111111111111111111111111111";
const saveUsdst = "2222222222222222222222222222222222222222";
const user = "3333333333333333333333333333333333333333";

const sources: PositionEventSource[] = [{
  sourceContract: custodyVault,
  targetActivitySourceAttribute: "token",
  events: {
    Locked: {
      action: "Withdraw",
      userAttribute: "from",
      amountAttribute: "amount",
    },
    Unlocked: {
      action: "Deposit",
      userAttribute: "to",
      amountAttribute: "amount",
    },
  },
}];

const event = (
  eventName: "Locked" | "Unlocked",
  attributes: Record<string, unknown>
): CirrusEvent => ({
  address: custodyVault,
  block_number: "100",
  block_timestamp: "2026-09-03 12:00:00 UTC",
  event_index: 7,
  event_name: eventName,
  transaction_sender: custodyVault,
  attributes,
});

test("builds routes from existing Position activity action types", () => {
  const routes = new Map();
  addPositionActivityRoute(routes, `0x${saveUsdst}`, "Deposit", "0");
  addPositionActivityRoute(routes, saveUsdst, "Withdraw", 1);

  assert.deepEqual(routes.get(saveUsdst), {
    Deposit: "Deposit",
    Withdraw: "Withdraw",
  });
});

test("maps custody locks to the activity's existing withdrawal event", () => {
  const mapped = mapPositionSourceEvent(
    event("Locked", { token: `0x${saveUsdst}`, from: user, amount: "100" }),
    sources,
    new Map([[saveUsdst, { Withdraw: "Withdraw" }]])
  );

  assert.deepEqual(mapped, {
    address: saveUsdst,
    event_name: "Withdraw",
    block_number: 100,
    block_timestamp: "2026-09-03 12:00:00 UTC",
    event_index: 7,
    transaction_sender: user,
    amount: "100",
  });
});

test("maps custody unlocks to the activity's existing deposit event", () => {
  const mapped = mapPositionSourceEvent(
    event("Unlocked", { token: saveUsdst, to: `0x${user}`, amount: 100 }),
    sources,
    new Map([[saveUsdst, { Deposit: "VaultDeposit" }]])
  );

  assert.equal(mapped?.address, saveUsdst);
  assert.equal(mapped?.event_name, "VaultDeposit");
  assert.equal(mapped?.transaction_sender, user);
  assert.equal(mapped?.amount, "100");
});

test("ignores tokens whose position activity has not opted in", () => {
  const mapped = mapPositionSourceEvent(
    event("Locked", { token: saveUsdst, from: user, amount: "100" }),
    sources,
    new Map()
  );

  assert.equal(mapped, null);
});

test("rejects malformed configured source events", () => {
  assert.throws(
    () => mapPositionSourceEvent(
      event("Locked", { token: saveUsdst, from: user }),
      sources,
      new Map([[saveUsdst, { Withdraw: "Withdraw" }]])
    ),
    /missing required attribute 'amount'/
  );
});
