import assert from "node:assert/strict";
import test from "node:test";
import { Interface } from "ethers";
import {
  buildActionDepositBatchArgs,
  classifyDepositLogs,
  RawDepositLog,
} from "../services/depositEventService";

const CHAIN_ID = 999;

// The config module exits the process on missing variables; satisfy it before importing it
for (const envVar of [
  "BA_USERNAME",
  "BA_PASSWORD",
  "CLIENT_SECRET",
  "CLIENT_ID",
  "OPENID_DISCOVERY_URL",
  "BRIDGE_ADDRESS",
  "PRICE_ORACLE_ADDRESS",
  "SAFE_ADDRESS",
  "SAFE_PROPOSER_ADDRESS",
  "SAFE_PROPOSER_PRIVATE_KEY",
]) {
  process.env[envVar] = process.env[envVar] || "test";
}
process.env[`CHAIN_${CHAIN_ID}_RPC_URL`] = "http://localhost:1/unused";

import { fetch as httpClient } from "../utils/api";
import {
  getChainLogs,
  getTransactionReceiptsBatch,
} from "../services/rpcService";
import { planLogWindows } from "./alchemyPolling";

const stubPost = <T>(handler: (body: any) => any, run: () => Promise<T>) => {
  const original = (httpClient as any).post;
  (httpClient as any).post = async (_url: string, body: any) => handler(body);
  return run().finally(() => {
    (httpClient as any).post = original;
  });
};

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

test("getChainLogs throws on a JSON-RPC error returned with HTTP 200", async () => {
  for (const code of [-32602, -32005]) {
    await stubPost(
      () => ({ jsonrpc: "2.0", id: 1, error: { code, message: "nope" } }),
      async () => {
        await assert.rejects(
          () => getChainLogs(CHAIN_ID, 1, 2, "0x00", ["0x00"]),
          new RegExp(`eth_getLogs failed on chain ${CHAIN_ID}.*${code}`),
        );
      },
    );
  }

  await stubPost(
    () => ({ jsonrpc: "2.0", id: 1, result: [] }),
    async () => {
      assert.deepEqual(await getChainLogs(CHAIN_ID, 1, 2, "0x00", ["0x00"]), []);
    },
  );
});

test("splits a catch-up range into windows below the getLogs cap", () => {
  const windows = planLogWindows(1, 5000, 800, 30);

  assert.equal(windows.length, 7);
  assert.deepEqual(windows[0], [1, 800]);
  assert.deepEqual(windows[6], [4801, 5000]);
  windows.slice(1).forEach(([from], i) => assert.equal(from, windows[i][1] + 1));

  // A gap wider than the per-tick cap is drained across ticks, never in one range
  const capped = planLogWindows(1, 1_000_000, 800, 30);
  assert.equal(capped.length, 30);
  assert.deepEqual(capped[29], [23_201, 24_000]);
});

test("keeps JSON-RPC batches within the 20-call submission limit", async () => {
  const txHashes = Array.from({ length: 21 }, (_, i) => `0x${String(i).padStart(64, "0")}`);
  const batchSizes: number[] = [];

  const receipts = await stubPost(
    (body: any[]) => {
      batchSizes.push(body.length);
      return body.map((call) => ({ id: call.id, result: { transactionHash: call.params[0] } }));
    },
    () => getTransactionReceiptsBatch(CHAIN_ID, txHashes),
  );

  assert.deepEqual(batchSizes, [20, 1]);
  assert.equal(receipts.size, 21);
  txHashes.forEach((txHash) =>
    assert.equal(receipts.get(txHash)?.transactionHash, txHash),
  );
});
