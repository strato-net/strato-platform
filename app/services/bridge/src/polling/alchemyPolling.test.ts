import assert from "node:assert/strict";
import test from "node:test";
import { Interface } from "ethers";
import {
  buildActionDepositBatchArgs,
  classifyDepositLogs,
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
  action = 2,
): RawDepositLog => {
  const encoded = events.encodeEventLog(
    events.getEvent(eventName)!,
    eventName === "DepositRouted"
      ? [token, 100n, sender, recipient, target, 1]
      : [token, 100n, sender, recipient, target, 1, action, metal, 90n],
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

test("parses AUTO_ROUTE action intent without changing its fields", () => {
  const actionDeposit = classifyDepositLogs(
    [makeLog("DepositRoutedWithAction", `0x${"ff".repeat(32)}`, 4)],
    1,
  ).actionDeposits[0];

  assert.equal(actionDeposit.action, "4");
  assert.equal(actionDeposit.actionToken, metal);
  assert.equal(actionDeposit.minFinalOut, "90");
});
