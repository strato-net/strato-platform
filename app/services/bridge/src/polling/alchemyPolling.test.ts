import assert from "node:assert/strict";
import test from "node:test";
import { Interface } from "ethers";
import {
  buildActionDepositBatchArgs,
  classifyDepositLogs,
  parseDepositLog,
  RawDepositLog,
} from "../services/depositEventService";

const events = new Interface([
  "event DepositRouted(address indexed token, uint256 amount, address indexed sender, address indexed stratoAddress, address targetStratoToken, uint96 depositId)",
  "event DepositRoutedWithAction(address indexed token, uint256 amount, address indexed sender, address indexed stratoAddress, address targetStratoToken, uint96 depositId, uint8 action, address actionToken, uint256 minFinalOut)",
]);

const token = "0x1111111111111111111111111111111111111111";
const sender = "0x2222222222222222222222222222222222222222";
const recipient = "0x3333333333333333333333333333333333333333";
const target = "0x4444444444444444444444444444444444444444";
const metal = "0x5555555555555555555555555555555555555555";

const makeLog = (
  eventName: "DepositRouted" | "DepositRoutedWithAction",
  transactionHash: string,
): RawDepositLog => {
  const encoded = events.encodeEventLog(
    events.getEvent(eventName)!,
    eventName === "DepositRouted"
      ? [token, 100n, sender, recipient, target, 1]
      : [token, 100n, sender, recipient, target, 1, 2, metal, 90n],
  );
  return {
    address: "0x6666666666666666666666666666666666666666",
    blockNumber: "0x10",
    data: encoded.data,
    logIndex: "0x0",
    topics: encoded.topics,
    transactionHash,
  };
};

test("classifies standard and action deposits from one log range", () => {
  const standardHash = `0x${"aa".repeat(32)}`;
  const actionHash = `0x${"bb".repeat(32)}`;
  const result = classifyDepositLogs(
    [
      makeLog("DepositRouted", standardHash),
      makeLog("DepositRoutedWithAction", actionHash),
    ],
    1,
  );

  assert.equal(result.standardDeposits.length, 1);
  assert.equal(result.standardDeposits[0].externalTxHash, standardHash);
  assert.equal(result.actionDeposits.length, 1);
  assert.equal(result.actionDeposits[0].action, "2");
  assert.equal(result.actionDeposits[0].actionToken, metal);
  assert.equal(result.actionDeposits[0].minFinalOut, "90");
});

test("rejects multi-deposit transactions", () => {
  const transactionHash = `0x${"cc".repeat(32)}`;
  const actionLog = makeLog("DepositRoutedWithAction", transactionHash);
  actionLog.logIndex = "0x1";
  assert.throws(
    () =>
      classifyDepositLogs(
        [makeLog("DepositRouted", transactionHash), actionLog],
        1,
      ),
    /Multiple deposit events/,
  );
});

test("deduplicates exact RPC log repeats", () => {
  const log = makeLog("DepositRouted", `0x${"cd".repeat(32)}`);
  const repeatedLog = { ...log, topics: [...log.topics] };
  const result = classifyDepositLogs([log, repeatedLog], 1);

  assert.equal(result.standardDeposits.length, 1);
  assert.equal(result.actionDeposits.length, 0);
});

test("rejects a deposit log that cannot be ABI decoded", () => {
  const malformed = makeLog("DepositRoutedWithAction", `0x${"dd".repeat(32)}`);
  malformed.data = "0x";
  assert.throws(
    () => classifyDepositLogs([malformed], 1),
    /data|buffer|overflow/i,
  );
});

test("preserves every action field in batch arguments", () => {
  const actionDeposit = classifyDepositLogs(
    [makeLog("DepositRoutedWithAction", `0x${"ee".repeat(32)}`)],
    1,
  ).actionDeposits[0];
  const args = buildActionDepositBatchArgs([actionDeposit]);

  assert.deepEqual(args.actions, ["2"]);
  assert.deepEqual(args.actionTokens, [metal]);
  assert.deepEqual(args.minFinalOuts, ["90"]);
});

// ── V2 router logs ────────────────────────────────────────────────────────
//
// V2 appends `maxFee`, which changes topic0. A relayer that only knows V1 does
// not fail loudly on a V2 log -- it simply never matches it, and deposits stop
// being seen. These pin that both generations decode.

const v2Events = new Interface([
  "event DepositRouted(address indexed token, uint256 amount, address indexed sender, address indexed stratoAddress, address targetStratoToken, uint96 depositId, uint256 maxFee)",
  "event DepositRoutedWithAction(address indexed token, uint256 amount, address indexed sender, address indexed stratoAddress, address targetStratoToken, uint96 depositId, uint256 maxFee, uint8 action, address actionToken, uint256 minFinalOut)",
]);

const makeV2Log = (
  eventName: "DepositRouted" | "DepositRoutedWithAction",
  transactionHash: string,
  maxFee: bigint,
): RawDepositLog => {
  const encoded = v2Events.encodeEventLog(
    v2Events.getEvent(eventName)!,
    eventName === "DepositRouted"
      ? [token, 100n, sender, recipient, target, 1, maxFee]
      : [token, 100n, sender, recipient, target, 1, maxFee, 2, metal, 90n],
  );
  return {
    address: token,
    topics: [...encoded.topics],
    data: encoded.data,
    transactionHash,
  } as RawDepositLog;
};

test("parses a V2 standard deposit and surfaces maxFee", () => {
  const parsed = parseDepositLog(makeV2Log("DepositRouted", "0xaa", 7n), 11155111);
  assert.equal(parsed.kind, "standard");
  assert.equal(parsed.deposit.maxFee, "7");
  assert.equal(parsed.deposit.externalTokenAmount, "100");
});

test("parses a V2 action deposit and surfaces maxFee", () => {
  const parsed = parseDepositLog(makeV2Log("DepositRoutedWithAction", "0xbb", 9n), 11155111);
  assert.equal(parsed.kind, "action");
  assert.equal(parsed.deposit.maxFee, "9");
});

test("V1 logs still parse, reporting a zero fee", () => {
  const parsed = parseDepositLog(makeLog("DepositRouted", "0xcc"), 11155111);
  assert.equal(parsed.kind, "standard");
  assert.equal(parsed.deposit.maxFee, "0", "a V1 deposit cannot be fast-filled");
});
