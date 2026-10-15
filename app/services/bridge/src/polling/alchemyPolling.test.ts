import "../test/setupEnv";
import assert from "node:assert/strict";
import test from "node:test";
import { Interface } from "ethers";
import {
  buildActionDepositBatchArgs,
  buildDepositWindowArgs,
  canonicalDepositKey,
  depositKeyTxHash,
  extractWindowDeposits,
  RawDepositLog,
} from "../services/depositEventService";
import { cirrus, fetch as httpClient } from "../utils/api";
import {
  getChainLogs,
  getTransactionReceiptsBatch,
} from "../services/rpcService";
import { blockTrackingService } from "../services/blockTrackingService";
import { depositRecorder } from "../services/depositRecorder";
import { planLogWindows, pollChainForDeposits } from "./alchemyPolling";
import { ChainInfo, WindowDeposit } from "../types";

const CHAIN_ID = 999;
process.env[`CHAIN_${CHAIN_ID}_RPC_URL`] = "http://localhost:1/unused";

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
  depositId = 1,
  blockNumber = 0x10,
  logIndex = 0,
): RawDepositLog => {
  const encoded = events.encodeEventLog(
    events.getEvent(eventName)!,
    eventName === "DepositRouted"
      ? [token, 100n, sender, recipient, target, depositId]
      : [token, 100n, sender, recipient, target, depositId, 2, metal, 90n],
  );
  return {
    address: "0x6666666666666666666666666666666666666666",
    blockNumber: `0x${blockNumber.toString(16)}`,
    data: encoded.data,
    logIndex: `0x${logIndex.toString(16)}`,
    topics: encoded.topics,
    transactionHash,
  };
};

test("extracts standard and action deposits with their router ids", () => {
  const standardHash = `0x${"aa".repeat(32)}`;
  const actionHash = `0x${"bb".repeat(32)}`;
  const result = extractWindowDeposits(
    [
      makeLog("DepositRouted", standardHash, 7),
      makeLog("DepositRoutedWithAction", actionHash, 8, 0x11),
    ],
    1,
  );

  assert.equal(result.length, 2);
  assert.equal(result[0].kind, "standard");
  assert.equal(result[0].depositId, "7");
  assert.equal(result[0].depositKey, standardHash);
  assert.equal(result[0].action, "0");
  assert.equal(result[1].kind, "action");
  assert.equal(result[1].depositId, "8");
  assert.equal(result[1].action, "2");
  assert.equal(result[1].actionToken, metal);
  assert.equal(result[1].minFinalOut, "90");
});

test("keys each deposit of a multi-deposit transaction by its router id", () => {
  const transactionHash = `0x${"CC".repeat(32)}`;
  const actionLog = makeLog("DepositRoutedWithAction", transactionHash, 12, 0x10, 1);
  const otherHash = `0x${"ce".repeat(32)}`;
  const result = extractWindowDeposits(
    [actionLog, makeLog("DepositRouted", transactionHash, 11), makeLog("DepositRouted", otherHash, 13, 0x12)],
    1,
  );

  const lowerHash = transactionHash.toLowerCase();
  assert.deepEqual(
    result.map((d) => [d.depositKey, d.sharesTransaction]),
    [
      [`${lowerHash}#11`, true],
      [`${lowerHash}#12`, true],
      [otherHash, false],
    ],
  );
  assert.equal(depositKeyTxHash(result[1].depositKey), lowerHash);
});

test("orders deposits by block and log index", () => {
  const result = extractWindowDeposits(
    [
      makeLog("DepositRouted", `0x${"01".repeat(32)}`, 3, 0x20, 0),
      makeLog("DepositRouted", `0x${"02".repeat(32)}`, 2, 0x10, 5),
      makeLog("DepositRouted", `0x${"03".repeat(32)}`, 1, 0x10, 2),
    ],
    1,
  );
  assert.deepEqual(result.map((d) => d.depositId), ["1", "2", "3"]);
});

test("rejects a window that reports one deposit id twice", () => {
  assert.throws(
    () =>
      extractWindowDeposits(
        [
          makeLog("DepositRouted", `0x${"04".repeat(32)}`, 5),
          makeLog("DepositRouted", `0x${"05".repeat(32)}`, 5, 0x11),
        ],
        1,
      ),
    /Deposit id 5 appears twice/,
  );
});

test("deduplicates exact RPC log repeats", () => {
  const log = makeLog("DepositRouted", `0x${"cd".repeat(32)}`);
  const repeatedLog = { ...log, topics: [...log.topics] };
  const result = extractWindowDeposits([log, repeatedLog], 1);

  assert.equal(result.length, 1);
  assert.equal(result[0].sharesTransaction, false);
});

test("rejects a deposit log that cannot be ABI decoded", () => {
  const malformed = makeLog("DepositRoutedWithAction", `0x${"dd".repeat(32)}`);
  malformed.data = "0x";
  assert.throws(
    () => extractWindowDeposits([malformed], 1),
    /data|buffer|overflow/i,
  );
});

test("preserves every action field in batch and window arguments", () => {
  const actionDeposit = extractWindowDeposits(
    [makeLog("DepositRoutedWithAction", `0x${"ee".repeat(32)}`, 9)],
    1,
  )[0];
  const args = buildActionDepositBatchArgs([actionDeposit]);

  assert.deepEqual(args.actions, ["2"]);
  assert.deepEqual(args.actionTokens, [metal]);
  assert.deepEqual(args.minFinalOuts, ["90"]);

  const windowArgs = buildDepositWindowArgs(1, 500, [actionDeposit]);
  assert.equal(windowArgs.lastProcessedBlock, 500);
  assert.deepEqual(windowArgs.depositIds, ["9"]);
  assert.deepEqual(windowArgs.externalTxHashes, [actionDeposit.depositKey]);
  assert.deepEqual(windowArgs.actions, ["2"]);
});

test("canonical deposit keys match the contract's normalization", () => {
  assert.equal(canonicalDepositKey("0xABcd"), "0xabcd");
  assert.equal(canonicalDepositKey("ABcd"), "0xabcd");
  assert.equal(canonicalDepositKey("0xABcd#007"), "0xabcd#7");
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

// ---------------- pollChainForDeposits ----------------

const chainInfo: ChainInfo = {
  externalChainId: CHAIN_ID,
  depositRouter: "0x6666666666666666666666666666666666666666",
  lastProcessedBlock: 0,
  enabled: true,
  custody: "0x7777777777777777777777777777777777777777",
  chainName: "Test",
};

const withPollStubs = async (
  {
    head,
    lastProcessed,
    missingBlocks = [],
    logsFor = () => [],
  }: {
    head: number;
    lastProcessed: number;
    missingBlocks?: number[];
    logsFor?: (from: number, to: number) => RawDepositLog[];
  },
  run: (seen: { windows: Array<[number, WindowDeposit[]]>; rpc: string[] }) => Promise<void>,
) => {
  const seen = { windows: [] as Array<[number, WindowDeposit[]]>, rpc: [] as string[] };
  const originalEffective = blockTrackingService.getEffectiveLastProcessedBlock;
  const originalRecord = depositRecorder.recordWindow;
  const originalCirrusGet = (cirrus as any).get;
  blockTrackingService.getEffectiveLastProcessedBlock = async () => lastProcessed;
  depositRecorder.recordWindow = async (_chainId, toBlock, deposits) => {
    seen.windows.push([toBlock, deposits]);
  };
  (cirrus as any).get = async () => [];
  try {
    await stubPost(
      (body: any) => {
        seen.rpc.push(body.method);
        switch (body.method) {
          case "eth_blockNumber":
            return { jsonrpc: "2.0", id: 1, result: `0x${head.toString(16)}` };
          case "eth_getBlockByNumber": {
            const block = parseInt(body.params[0], 16);
            return { jsonrpc: "2.0", id: 1, result: missingBlocks.includes(block) ? null : { number: body.params[0] } };
          }
          case "eth_getLogs":
            return {
              jsonrpc: "2.0",
              id: 1,
              result: logsFor(parseInt(body.params[0].fromBlock, 16), parseInt(body.params[0].toBlock, 16)),
            };
          default:
            throw new Error(`unexpected RPC ${body.method}`);
        }
      },
      () => run(seen),
    );
  } finally {
    blockTrackingService.getEffectiveLastProcessedBlock = originalEffective;
    depositRecorder.recordWindow = originalRecord;
    (cirrus as any).get = originalCirrusGet;
  }
};

test("scans only blocks buried under the configured confirmations", async () => {
  process.env[`CHAIN_${CHAIN_ID}_CONFIRMATIONS`] = "4";
  process.env[`CHAIN_${CHAIN_ID}_LOGS_SPAN`] = "10";
  try {
    await withPollStubs({ head: 1024, lastProcessed: 1000 }, async (seen) => {
      await pollChainForDeposits(chainInfo);
      assert.deepEqual(seen.windows.map(([toBlock]) => toBlock), [1010, 1020]);
    });
    await withPollStubs({ head: 1004, lastProcessed: 1000 }, async (seen) => {
      await pollChainForDeposits(chainInfo);
      assert.deepEqual(seen.windows, []);
      assert.deepEqual(seen.rpc, ["eth_blockNumber"]);
    });
  } finally {
    delete process.env[`CHAIN_${CHAIN_ID}_CONFIRMATIONS`];
    delete process.env[`CHAIN_${CHAIN_ID}_LOGS_SPAN`];
  }
});

test("never passes a block the RPC endpoint cannot serve yet", async () => {
  process.env[`CHAIN_${CHAIN_ID}_CONFIRMATIONS`] = "0";
  process.env[`CHAIN_${CHAIN_ID}_LOGS_SPAN`] = "10";
  try {
    await withPollStubs({ head: 1030, lastProcessed: 1000, missingBlocks: [1020] }, async (seen) => {
      await assert.rejects(() => pollChainForDeposits(chainInfo), /cannot serve block 1020/);
      assert.deepEqual(seen.windows.map(([toBlock]) => toBlock), [1010]);
      assert.equal(seen.rpc.filter((m) => m === "eth_getLogs").length, 1);
    });
  } finally {
    delete process.env[`CHAIN_${CHAIN_ID}_CONFIRMATIONS`];
    delete process.env[`CHAIN_${CHAIN_ID}_LOGS_SPAN`];
  }
});

test("hands every window, empty or not, to the recorder with keyed deposits", async () => {
  process.env[`CHAIN_${CHAIN_ID}_CONFIRMATIONS`] = "0";
  process.env[`CHAIN_${CHAIN_ID}_LOGS_SPAN`] = "10";
  const sharedHash = `0x${"f1".repeat(32)}`;
  try {
    await withPollStubs(
      {
        head: 1020,
        lastProcessed: 1000,
        logsFor: (from) =>
          from === 1011
            ? [
                makeLog("DepositRouted", sharedHash, 21, 1012, 0),
                makeLog("DepositRouted", sharedHash, 22, 1012, 1),
              ]
            : [],
      },
      async (seen) => {
        await pollChainForDeposits(chainInfo);
        assert.deepEqual(seen.windows.map(([toBlock, deposits]) => [toBlock, deposits.map((d) => d.depositKey)]), [
          [1010, []],
          [1020, [`${sharedHash}#21`, `${sharedHash}#22`]],
        ]);
      },
    );
  } finally {
    delete process.env[`CHAIN_${CHAIN_ID}_CONFIRMATIONS`];
    delete process.env[`CHAIN_${CHAIN_ID}_LOGS_SPAN`];
  }
});
