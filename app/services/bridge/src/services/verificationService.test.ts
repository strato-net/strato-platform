import "../test/setupEnv";
import assert from "node:assert/strict";
import test from "node:test";
import { Interface } from "ethers";
import { config, TRANSFER_EVENT_SIGNATURE, ZERO_ADDRESS } from "../config";
import { DepositInfo } from "../types";
import { cirrus, fetch as httpClient } from "../utils/api";
import { getInternalTransactionsBatch, getTransactionReceiptsBatch } from "./rpcService";
import { verifyDepositsBatch } from "./verificationService";

const CHAIN_ID = 998;
process.env[`CHAIN_${CHAIN_ID}_RPC_URL`] = "http://localhost:1/unused";

const SAFE = "0x8c458f866e603335ef179a63a2528f357732f5d5";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const ROUTER = "0xc3be40e5eae865d6d80ec334f009eb1bdd107e1b";
const USER_SAFE = "0x84af830f8befb46e5db1295f7a8635992cb3e7d9";
const EOA = "0xec903a1eb8b8f626499bc740461b39866d3c0c46";
const RECIPIENT = "0x721700123ce2cdab084d93186cd08fd12ab76c8d";
const OTHER_RECIPIENT = "0x2222222222222222222222222222222222222222";
const ETH_STRATO_TOKEN = "0x93fb7295859b2d70199e0a4883b7c320cf874e6c";
const pad = (hex: string) => `0x${hex.replace(/^0x/, "").padStart(64, "0")}`;

const routerInterface = new Interface([
  "event DepositRouted(address indexed token, uint256 amount, address indexed sender, address indexed stratoAddress, address targetStratoToken, uint96 depositId)",
]);

const makeDepositRoutedLog = ({
  txHash,
  router = ROUTER,
  token = ZERO_ADDRESS,
  amount = 1_000_000_000_000_000n,
  sender = USER_SAFE,
  recipient = RECIPIENT,
  targetStratoToken = ETH_STRATO_TOKEN,
  depositId = 971,
  logIndex = "0x1",
}: {
  txHash: string;
  router?: string;
  token?: string;
  amount?: bigint;
  sender?: string;
  recipient?: string;
  targetStratoToken?: string;
  depositId?: number;
  logIndex?: string;
}) => {
  const encoded = routerInterface.encodeEventLog(
    routerInterface.getEvent("DepositRouted")!,
    [token, amount, sender, recipient, targetStratoToken, depositId],
  );
  return {
    address: router,
    blockNumber: "0x19397c8",
    data: encoded.data,
    logIndex,
    topics: encoded.topics,
    transactionHash: txHash,
  };
};

const makeEthDeposit = (
  txHash: string,
  amountWei: string,
  overrides: Partial<DepositInfo> = {},
): DepositInfo => ({
  bridgeStatus: "1",
  externalSender: USER_SAFE,
  externalToken: ZERO_ADDRESS,
  requestedAt: "0",
  stratoRecipient: RECIPIENT,
  stratoToken: ETH_STRATO_TOKEN,
  stratoTokenAmount: amountWei,
  timestamp: "0",
  externalChainId: CHAIN_ID,
  externalTxHash: txHash,
  externalDecimals: 18,
  depositRouter: ROUTER,
  ...overrides,
});

const withMockedRpc = async (
  receipt: any,
  traces: any[],
  fn: () => Promise<void>,
) => {
  const originalPost = (httpClient as any).post;
  const originalGet = (cirrus as any).get;
  const originalSafe = config.safe.address;
  (httpClient as any).post = async (_url: string, body: any[]) =>
    body.map((call) => ({
      id: call.id,
      result: call.method === "eth_getTransactionReceipt" ? receipt : traces,
    }));
  (cirrus as any).get = async () => [];
  config.safe.address = SAFE;
  try {
    await fn();
  } finally {
    (httpClient as any).post = originalPost;
    (cirrus as any).get = originalGet;
    config.safe.address = originalSafe;
  }
};

const withTxHash = (txHash: string, traces: any[]) =>
  traces.map((trace) => ({ transactionHash: txHash, ...trace }));

test("deposits keyed by '<hash>#<depositId>' are verified against their source transaction", async () => {
  const txHash = `0x${"ab".repeat(32)}`;
  const deposits: DepositInfo[] = [5, 6].map((depositId, i) => ({
    bridgeStatus: "1",
    externalSender: "0x1111111111111111111111111111111111111111",
    externalToken: USDC,
    requestedAt: "0",
    stratoRecipient: "0x2222222222222222222222222222222222222222",
    stratoToken: "0x6aeacaa19c68e53035bf495d15e0a328fc600ba8",
    stratoTokenAmount: `${i + 1}000000000000000000`,
    timestamp: "0",
    externalChainId: CHAIN_ID,
    externalTxHash: `${txHash}#${depositId}`,
    externalDecimals: 6,
    depositRouter: ROUTER,
  }));

  const receipt = {
    status: "0x1",
    transactionHash: txHash,
    to: ROUTER,
    logs: [1_000_000, 2_000_000].map((amount) => ({
      address: USDC,
      topics: [TRANSFER_EVENT_SIGNATURE, pad("1111111111111111111111111111111111111111"), pad(SAFE)],
      data: pad(amount.toString(16)),
      transactionHash: txHash,
    })),
  };

  const requested: string[] = [];
  const originalPost = (httpClient as any).post;
  const originalGet = (cirrus as any).get;
  const originalSafe = config.safe.address;
  (httpClient as any).post = async (_url: string, body: any[]) =>
    body.map((call) => {
      requested.push(`${call.method}:${call.params[0]}`);
      return {
        id: call.id,
        result: call.method === "eth_getTransactionReceipt" ? receipt : [],
      };
    });
  (cirrus as any).get = async () => [];
  config.safe.address = SAFE;
  try {
    const results = await verifyDepositsBatch(deposits);

    assert.deepEqual(requested.sort(), [
      `eth_getTransactionReceipt:${txHash}`,
      `trace_transaction:${txHash}`,
    ]);
    for (const deposit of deposits) {
      assert.equal(results.get(deposit.externalTxHash), null);
    }
  } finally {
    (httpClient as any).post = originalPost;
    (cirrus as any).get = originalGet;
    config.safe.address = originalSafe;
  }
});

test("verifies the real Gnosis Safe ETH deposit receipt and trace (0xd09bcbef...14a9)", async () => {
  const txHash = "0xd09bcbef4f0f8d955daca565b31193110c066a8c8a3991f36ea9812f682014a9";
  const amountWei = "1000000000000000";
  const amountHex = "0x38d7ea4c68000";
  const deposit = makeEthDeposit(txHash, amountWei, {
    // Cirrus stores STRATO addresses without 0x prefix
    externalSender: USER_SAFE.slice(2),
    stratoRecipient: RECIPIENT.slice(2),
    stratoToken: ETH_STRATO_TOKEN.slice(2),
    externalToken: ZERO_ADDRESS.slice(2),
    depositRouter: ROUTER.slice(2),
  });

  // Real logs emitted on Ethereum mainnet block 26450520 for tx 0xd09bcbef...14a9
  const receipt = {
    status: "0x1",
    transactionHash: txHash,
    from: EOA,
    to: USER_SAFE,
    logs: [
      {
        address: USER_SAFE,
        blockNumber: "0x19397c8",
        logIndex: "0x211",
        topics: ["0x66753cd2356569ee081232e3be8909b950e0a76c1f8460c3a5e3c2be32b11bed"],
        data: "0x",
        transactionHash: txHash,
      },
      {
        address: SAFE,
        blockNumber: "0x19397c8",
        logIndex: "0x212",
        topics: [
          "0x3d0ce9bfc3ed7d6862dbb28b2dea94561fe714a1b4d019aa8af39730d1ad7c3d",
          "0x000000000000000000000000c3be40e5eae865d6d80ec334f009eb1bdd107e1b",
        ],
        data: "0x00000000000000000000000000000000000000000000000000038d7ea4c68000",
        transactionHash: txHash,
      },
      {
        address: ROUTER,
        blockNumber: "0x19397c8",
        logIndex: "0x213",
        topics: [
          "0x55426533b384af6fcfee0e834a6407e3ffc370a0b1b53400c4e6ec92d7f1f750",
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          "0x00000000000000000000000084af830f8befb46e5db1295f7a8635992cb3e7d9",
          "0x000000000000000000000000721700123ce2cdab084d93186cd08fd12ab76c8d",
        ],
        data: "0x00000000000000000000000000000000000000000000000000038d7ea4c6800000000000000000000000000093fb7295859b2d70199e0a4883b7c320cf874e6c00000000000000000000000000000000000000000000000000000000000003cb",
        transactionHash: txHash,
      },
      {
        address: USER_SAFE,
        blockNumber: "0x19397c8",
        logIndex: "0x214",
        topics: ["0x442e715f626346e8c54381002da614f62bee8d27386535b2521ec8540898556e"],
        data: "0x17683beac864deb363501a868f43d1d4a18ac98b7ca97005f64d0189b999e7340000000000000000000000000000000000000000000000000000000000000000",
        transactionHash: txHash,
      },
    ],
  };

  const traces = withTxHash(txHash, [
    { type: "call", traceAddress: [], action: { callType: "call", from: EOA, to: USER_SAFE, value: "0x0" } },
    { type: "call", traceAddress: [0], action: { callType: "delegatecall", from: USER_SAFE, to: "0xfb1bffc9d739b8d520daf37df666da4c687191ea", value: "0x0" } },
    { type: "call", traceAddress: [0, 0], action: { callType: "call", from: USER_SAFE, to: ROUTER, value: amountHex } },
    { type: "call", traceAddress: [0, 0, 0], action: { callType: "delegatecall", from: ROUTER, to: "0x3e487139b6e5e7b22350b04d01a8157952e6498f", value: amountHex } },
    { type: "call", traceAddress: [0, 0, 0, 0], action: { callType: "call", from: ROUTER, to: SAFE, value: amountHex } },
    { type: "call", traceAddress: [0, 0, 0, 0, 0], action: { callType: "delegatecall", from: SAFE, to: "0x41675c099f32341bf84bfc5382af534df5c7461a", value: amountHex } },
  ]);

  await withMockedRpc(receipt, traces, async () => {
    const results = await verifyDepositsBatch([deposit]);
    assert.equal(results.get(txHash), null);
  });
});

test("rejects smart-wallet ETH transfer without a configured DepositRouter event", async () => {
  const txHash = `0x${"aa".repeat(32)}`;
  const deposit = makeEthDeposit(txHash, "1000000000000000");
  const receipt = { status: "0x1", transactionHash: txHash, to: USER_SAFE, logs: [] };
  const traces = withTxHash(txHash, [
    { type: "call", traceAddress: [], action: { callType: "call", from: EOA, to: USER_SAFE, value: "0x0" } },
    { type: "call", traceAddress: [0], action: { callType: "call", from: USER_SAFE, to: SAFE, value: "0x38d7ea4c68000" } },
  ]);

  await withMockedRpc(receipt, traces, async () => {
    const results = await verifyDepositsBatch([deposit]);
    assert.match(results.get(txHash)?.message ?? "", /no DepositRouter event/);
  });
});

test("rejects routed ETH deposit when router event fields or payment source do not match", async () => {
  const txHash = `0x${"bb".repeat(32)}`;
  const validTraces = withTxHash(txHash, [
    { type: "call", traceAddress: [], action: { callType: "call", from: EOA, to: USER_SAFE, value: "0x0" } },
    { type: "call", traceAddress: [0], action: { callType: "call", from: ROUTER, to: SAFE, value: "0x38d7ea4c68000" } },
  ]);
  const validReceipt = {
    status: "0x1",
    transactionHash: txHash,
    to: USER_SAFE,
    logs: [makeDepositRoutedLog({ txHash, depositId: 42 })],
  };

  // Wrong recipient
  await withMockedRpc(validReceipt, validTraces, async () => {
    const d = makeEthDeposit(txHash, "1000000000000000", { stratoRecipient: OTHER_RECIPIENT });
    const results = await verifyDepositsBatch([d]);
    assert.match(results.get(txHash)?.message ?? "", /No matching DepositRouter event/);
  });

  // Wrong sender
  await withMockedRpc(validReceipt, validTraces, async () => {
    const d = makeEthDeposit(txHash, "1000000000000000", { externalSender: EOA });
    const results = await verifyDepositsBatch([d]);
    assert.match(results.get(txHash)?.message ?? "", /No matching DepositRouter event/);
  });

  // Wrong depositId in key
  await withMockedRpc(validReceipt, validTraces, async () => {
    const key = `${txHash}#99`;
    const d = makeEthDeposit(key, "1000000000000000");
    const results = await verifyDepositsBatch([d]);
    assert.match(results.get(key)?.message ?? "", /No matching DepositRouter event/);
  });

  // Event emitted by an untrusted router
  const fakeRouter = "0x000000000000000000000000000000000000dead";
  await withMockedRpc(
    {
      status: "0x1",
      transactionHash: txHash,
      to: USER_SAFE,
      logs: [makeDepositRoutedLog({ txHash, router: fakeRouter, depositId: 42 })],
    },
    validTraces,
    async () => {
      const results = await verifyDepositsBatch([makeEthDeposit(txHash, "1000000000000000")]);
      assert.match(results.get(txHash)?.message ?? "", /no DepositRouter event/);
    },
  );

  // Payment to Safe came from USER_SAFE rather than ROUTER
  await withMockedRpc(
    validReceipt,
    withTxHash(txHash, [
      { type: "call", traceAddress: [], action: { callType: "call", from: EOA, to: USER_SAFE, value: "0x0" } },
      { type: "call", traceAddress: [0], action: { callType: "call", from: USER_SAFE, to: SAFE, value: "0x38d7ea4c68000" } },
    ]),
    async () => {
      const results = await verifyDepositsBatch([makeEthDeposit(txHash, "1000000000000000")]);
      assert.match(results.get(txHash)?.message ?? "", /Insufficient ETH transfers from DepositRouter/);
    },
  );
});

test("accounts for each payment once across two equal-sized ETH deposits in one transaction", async () => {
  const txHash = `0x${"cc".repeat(32)}`;
  const amountWei = "1000000000000000";
  const amountHex = "0x38d7ea4c68000";
  const depositA = makeEthDeposit(`${txHash}#10`, amountWei, { stratoRecipient: RECIPIENT });
  const depositB = makeEthDeposit(`${txHash}#11`, amountWei, { stratoRecipient: OTHER_RECIPIENT });
  const receipt = {
    status: "0x1",
    transactionHash: txHash,
    to: USER_SAFE,
    logs: [
      makeDepositRoutedLog({ txHash, depositId: 10, recipient: RECIPIENT, logIndex: "0x1" }),
      makeDepositRoutedLog({ txHash, depositId: 11, recipient: OTHER_RECIPIENT, logIndex: "0x2" }),
    ],
  };

  // Two distinct router-to-custody payments: both deposits pass
  const twoPaymentTraces = withTxHash(txHash, [
    { type: "call", traceAddress: [], action: { callType: "call", from: EOA, to: USER_SAFE, value: "0x0" } },
    { type: "call", traceAddress: [0, 0], action: { callType: "call", from: ROUTER, to: SAFE, value: amountHex } },
    { type: "call", traceAddress: [0, 1], action: { callType: "call", from: ROUTER, to: SAFE, value: amountHex } },
  ]);
  await withMockedRpc(receipt, twoPaymentTraces, async () => {
    const results = await verifyDepositsBatch([depositA, depositB]);
    assert.equal(results.get(depositA.externalTxHash), null);
    assert.equal(results.get(depositB.externalTxHash), null);
  });

  // Only one router-to-custody payment for two equal-sized router events: rejected (both together and individually)
  const onePaymentTraces = withTxHash(txHash, [
    { type: "call", traceAddress: [], action: { callType: "call", from: EOA, to: USER_SAFE, value: "0x0" } },
    { type: "call", traceAddress: [0, 0], action: { callType: "call", from: ROUTER, to: SAFE, value: amountHex } },
  ]);
  await withMockedRpc(receipt, onePaymentTraces, async () => {
    const batchResults = await verifyDepositsBatch([depositA, depositB]);
    assert.match(batchResults.get(depositA.externalTxHash)?.message ?? "", /Insufficient ETH transfers/);
    assert.match(batchResults.get(depositB.externalTxHash)?.message ?? "", /Insufficient ETH transfers/);

    const singleResults = await verifyDepositsBatch([depositA]);
    assert.match(singleResults.get(depositA.externalTxHash)?.message ?? "", /Insufficient ETH transfers/);
  });

  // Duplicate claims targeting the same single router event/payment in one batch: only the first succeeds
  const singleEventReceipt = {
    status: "0x1",
    transactionHash: txHash,
    to: USER_SAFE,
    logs: [makeDepositRoutedLog({ txHash, depositId: 10, recipient: RECIPIENT, logIndex: "0x1" })],
  };
  await withMockedRpc(singleEventReceipt, onePaymentTraces, async () => {
    const plainClaim = makeEthDeposit(txHash, amountWei, { stratoRecipient: RECIPIENT });
    const results = await verifyDepositsBatch([plainClaim, depositA]);
    assert.equal(results.get(plainClaim.externalTxHash), null);
    assert.match(results.get(depositA.externalTxHash)?.message ?? "", /No matching DepositRouter event/);
  });
});

test("enforces explicit attribution for direct-to-custody ETH deposits", async () => {
  const txHash = `0x${"11".repeat(32)}`;
  const receipt = { status: "0x1", transactionHash: txHash, from: EOA, to: SAFE, logs: [] };
  const traces = withTxHash(txHash, [
    { type: "call", traceAddress: [], action: { callType: "call", from: EOA, to: SAFE, value: "0x38d7ea4c68000" } },
  ]);

  // Direct send attributed to actual tx sender
  await withMockedRpc(receipt, traces, async () => {
    const deposit = makeEthDeposit(txHash, "1000000000000000", { externalSender: EOA });
    const results = await verifyDepositsBatch([deposit]);
    assert.equal(results.get(txHash), null);
  });

  // Direct send attributed via Stripe onramp sentinel (externalSender === custody Safe)
  await withMockedRpc(receipt, traces, async () => {
    const deposit = makeEthDeposit(txHash, "1000000000000000", { externalSender: SAFE });
    const results = await verifyDepositsBatch([deposit]);
    assert.equal(results.get(txHash), null);
  });

  // Direct send with unrelated externalSender is rejected
  await withMockedRpc(receipt, traces, async () => {
    const deposit = makeEthDeposit(txHash, "1000000000000000", { externalSender: USER_SAFE });
    const results = await verifyDepositsBatch([deposit]);
    assert.match(results.get(txHash)?.message ?? "", /No matching direct ETH transfer/);
  });

  // Direct call to Safe with zero ETH value is rejected
  await withMockedRpc(
    receipt,
    withTxHash(txHash, [
      { type: "call", traceAddress: [], action: { callType: "call", from: EOA, to: SAFE, value: "0x0" } },
    ]),
    async () => {
      const deposit = makeEthDeposit(txHash, "1000000000000000", { externalSender: EOA });
      const results = await verifyDepositsBatch([deposit]);
      assert.match(results.get(txHash)?.message ?? "", /No matching direct ETH transfer/);
    },
  );
});

test("rejects delegatecall, direct revert, reverted ancestor, and self-call traces even with router log", async () => {
  const txHash = `0x${"33".repeat(32)}`;
  const deposit = makeEthDeposit(txHash, "1000000000000000");
  const receipt = {
    status: "0x1",
    transactionHash: txHash,
    to: USER_SAFE,
    logs: [makeDepositRoutedLog({ txHash, depositId: 50 })],
  };

  // delegatecall preserving msg.value
  await withMockedRpc(
    receipt,
    withTxHash(txHash, [
      { type: "call", traceAddress: [], action: { callType: "call", from: EOA, to: USER_SAFE, value: "0x38d7ea4c68000" } },
      { type: "call", traceAddress: [0], action: { callType: "delegatecall", from: ROUTER, to: SAFE, value: "0x38d7ea4c68000" } },
    ]),
    async () => {
      const results = await verifyDepositsBatch([deposit]);
      assert.match(results.get(txHash)?.message ?? "", /Insufficient ETH transfers/);
    },
  );

  // Direct trace error
  await withMockedRpc(
    receipt,
    withTxHash(txHash, [
      { type: "call", traceAddress: [], action: { callType: "call", from: EOA, to: USER_SAFE, value: "0x0" } },
      { type: "call", traceAddress: [0], action: { callType: "call", from: ROUTER, to: SAFE, value: "0x38d7ea4c68000" }, error: "Reverted" },
    ]),
    async () => {
      const results = await verifyDepositsBatch([deposit]);
      assert.match(results.get(txHash)?.message ?? "", /Insufficient ETH transfers/);
    },
  );

  // Inner transfer rolled back by reverted ancestor frame
  await withMockedRpc(
    receipt,
    withTxHash(txHash, [
      { type: "call", traceAddress: [], action: { callType: "call", from: EOA, to: USER_SAFE, value: "0x0" } },
      { type: "call", traceAddress: [0], action: { callType: "call", from: USER_SAFE, to: ROUTER, value: "0x38d7ea4c68000" }, error: "Reverted" },
      { type: "call", traceAddress: [0, 0], action: { callType: "call", from: ROUTER, to: SAFE, value: "0x38d7ea4c68000" } },
    ]),
    async () => {
      const results = await verifyDepositsBatch([deposit]);
      assert.match(results.get(txHash)?.message ?? "", /Insufficient ETH transfers/);
    },
  );

  // Self-call SAFE -> SAFE
  await withMockedRpc(
    { status: "0x1", transactionHash: txHash, from: EOA, to: SAFE, logs: [] },
    withTxHash(txHash, [
      { type: "call", traceAddress: [], action: { callType: "call", from: EOA, to: SAFE, value: "0x0" } },
      { type: "call", traceAddress: [0], action: { callType: "call", from: SAFE, to: SAFE, value: "0x38d7ea4c68000" } },
    ]),
    async () => {
      const results = await verifyDepositsBatch([makeEthDeposit(txHash, "1000000000000000", { externalSender: EOA })]);
      assert.match(results.get(txHash)?.message ?? "", /No matching direct ETH transfer/);
    },
  );

  // Unrelated sibling revert does not reject a valid router transfer
  await withMockedRpc(
    receipt,
    withTxHash(txHash, [
      { type: "call", traceAddress: [], action: { callType: "call", from: EOA, to: USER_SAFE, value: "0x0" } },
      { type: "call", traceAddress: [0, 0], action: { callType: "call", from: USER_SAFE, to: ROUTER, value: "0x38d7ea4c68000" }, error: "Reverted" },
      { type: "call", traceAddress: [0, 1], action: { callType: "call", from: ROUTER, to: SAFE, value: "0x38d7ea4c68000" } },
    ]),
    async () => {
      const results = await verifyDepositsBatch([deposit]);
      assert.equal(results.get(txHash), null);
    },
  );
});

test("RPC batch loaders correlate by JSON-RPC id and reject mismatched transaction hashes", async () => {
  const txA = `0x${"a1".repeat(32)}`;
  const txB = `0x${"b2".repeat(32)}`;
  const originalPost = (httpClient as any).post;

  try {
    // Reordered batch responses match by id
    (httpClient as any).post = async (_url: string, body: any[]) => [
      {
        id: body[1].id,
        result:
          body[1].method === "eth_getTransactionReceipt"
            ? { status: "0x1", transactionHash: txB }
            : [{ transactionHash: txB, type: "call", traceAddress: [] }],
      },
      {
        id: body[0].id,
        result:
          body[0].method === "eth_getTransactionReceipt"
            ? { status: "0x1", transactionHash: txA }
            : [{ transactionHash: txA, type: "call", traceAddress: [] }],
      },
    ];

    const receipts = await getTransactionReceiptsBatch(CHAIN_ID, [txA, txB]);
    assert.equal(receipts.get(txA)?.transactionHash, txA);
    assert.equal(receipts.get(txB)?.transactionHash, txB);

    const traces = await getInternalTransactionsBatch(CHAIN_ID, [txA, txB]);
    assert.equal(traces.get(txA)?.[0]?.transactionHash, txA);
    assert.equal(traces.get(txB)?.[0]?.transactionHash, txB);

    // Mismatched transactionHash on response payload is rejected even when id matches
    (httpClient as any).post = async (_url: string, body: any[]) =>
      body.map((call) => ({
        id: call.id,
        result:
          call.method === "eth_getTransactionReceipt"
            ? { status: "0x1", transactionHash: txB }
            : [{ transactionHash: txB, type: "call", traceAddress: [] }],
      }));

    const mismatchedReceipts = await getTransactionReceiptsBatch(CHAIN_ID, [txA, txB]);
    assert.equal(mismatchedReceipts.get(txA), undefined);
    assert.equal(mismatchedReceipts.get(txB)?.transactionHash, txB);

    const mismatchedTraces = await getInternalTransactionsBatch(CHAIN_ID, [txA, txB]);
    assert.equal(mismatchedTraces.get(txA), undefined);
    assert.equal(mismatchedTraces.get(txB)?.[0]?.transactionHash, txB);

    // Trace batching respects the 20-call RPC batch limit
    const manyHashes = Array.from({ length: 21 }, (_, i) => `0x${String(i).padStart(64, "0")}`);
    const batchSizes: number[] = [];
    (httpClient as any).post = async (_url: string, body: any[]) => {
      batchSizes.push(body.length);
      return body.map((call) => ({
        id: call.id,
        result: [{ transactionHash: call.params[0], type: "call", traceAddress: [] }],
      }));
    };
    const chunkedTraces = await getInternalTransactionsBatch(CHAIN_ID, manyHashes);
    assert.deepEqual(batchSizes, [20, 1]);
    assert.equal(chunkedTraces.size, 21);
  } finally {
    (httpClient as any).post = originalPost;
  }
});
