import assert from "node:assert/strict";
import test from "node:test";
import { CirrusEvent, PositionEventSource } from "../../shared/types";
import {
  addPositionActivityRoute,
  mapPositionSourceEvent,
  mapShareTransferEvent,
} from "./positionEvent.adapter";

const custodyVault = "1111111111111111111111111111111111111111";
const saveUsdst = "2222222222222222222222222222222222222222";
const user = "3333333333333333333333333333333333333333";

const sources: PositionEventSource[] = [{
  networkId: "114784819836269",
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
  transaction_hash: "0x" + "a".repeat(64),
  attributes,
});

test("builds routes from existing Position activity action types", () => {
  const routes = new Map();
  addPositionActivityRoute(
    routes,
    `0x${saveUsdst}`,
    "Deposit",
    "0000000000000000000000000000000000000000"
  );
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

const recipient = "4444444444444444444444444444444444444444";
const zeroAddress = "0000000000000000000000000000000000000000";
const transferRoutes = new Map([[saveUsdst, { Deposit: "Deposit", Withdraw: "Withdraw", Transfer: "Transfer" }]]);
const custodyAddresses = new Set([custodyVault]);

const transfer = (attributes: Record<string, unknown>): CirrusEvent => ({
  address: saveUsdst,
  block_number: "100",
  block_timestamp: "2026-09-03 12:00:00 UTC",
  event_index: 9,
  event_name: "Transfer",
  transaction_hash: "0x" + "b".repeat(64),
  transaction_sender: user,
  attributes,
});

test("routes Transfer action types", () => {
  const routes = new Map();
  assert.equal(addPositionActivityRoute(routes, saveUsdst, "Transfer", 3), "Transfer");
  assert.equal(addPositionActivityRoute(routes, saveUsdst, "Moved", "Transfer"), "Transfer");
  assert.equal(addPositionActivityRoute(routes, saveUsdst, "Swap", 2), null);

  assert.deepEqual(routes.get(saveUsdst), { Transfer: "Transfer" });
});

test("maps wallet-to-wallet share transfers with sender and recipient", () => {
  const mapped = mapShareTransferEvent(
    transfer({ from: `0x${user}`, to: recipient, value: "100" }),
    transferRoutes,
    custodyAddresses
  );

  assert.deepEqual(mapped, {
    address: saveUsdst,
    event_name: "Transfer",
    block_number: 100,
    block_timestamp: "2026-09-03 12:00:00 UTC",
    event_index: 9,
    transaction_sender: user,
    recipient,
    amount: "100",
  });
});

test("skips mints, burns, custody and vault-internal share moves", () => {
  const skipped: [string, string][] = [
    [zeroAddress, user],
    [user, zeroAddress],
    [user, custodyVault],
    [custodyVault, user],
    [user, saveUsdst],
    [saveUsdst, user],
    [user, user],
  ];
  for (const [from, to] of skipped) {
    assert.equal(
      mapShareTransferEvent(transfer({ from, to, value: "100" }), transferRoutes, custodyAddresses),
      null,
      `${from} -> ${to}`
    );
  }
});

test("skips zero-value transfers and tokens without a Transfer route", () => {
  assert.equal(
    mapShareTransferEvent(transfer({ from: user, to: recipient, value: "0" }), transferRoutes, custodyAddresses),
    null
  );
  assert.equal(
    mapShareTransferEvent(
      transfer({ from: user, to: recipient, value: "100" }),
      new Map([[saveUsdst, { Deposit: "Deposit", Withdraw: "Withdraw" }]]),
      custodyAddresses
    ),
    null
  );
});

test("rejects malformed share transfers", () => {
  assert.throws(
    () => mapShareTransferEvent(transfer({ from: user, to: recipient }), transferRoutes, custodyAddresses),
    /missing required attribute 'value'/
  );
});
