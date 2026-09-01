import assert from "node:assert/strict";
import test from "node:test";
import { ethers } from "ethers";
import type { DepositArgs, DepositInfo } from "../types";

for (const name of [
  "BA_USERNAME",
  "BA_PASSWORD",
  "CLIENT_SECRET",
  "CLIENT_ID",
  "OPENID_DISCOVERY_URL",
  "BRIDGE_ADDRESS",
  "EXTERNAL_ASSET_BRIDGE_ADDRESS",
  "EXTERNAL_BRIDGE_SIGNER_API_TOKEN",
  "PRICE_ORACLE_ADDRESS",
  "SAFE_ADDRESS",
  "SAFE_PROPOSER_ADDRESS",
  "SAFE_PROPOSER_KMS_URL",
  "SAFE_PROPOSER_KMS_API_TOKEN",
  "RELAYER_BA_USERNAME",
  "RELAYER_BA_PASSWORD",
  "RELAYER_CLIENT_ID",
  "RELAYER_CLIENT_SECRET",
  "RELAYER_OPENID_DISCOVERY_URL",
]) {
  process.env[name] ||= "test";
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TRANSFER_EVENT_SIGNATURE = ethers.id("Transfer(address,address,uint256)");
const verificationService = import("./verificationService");

const chainId = 11155111;
const externalToken = "0x1111111111111111111111111111111111111111";
const depositRouter = "0x2222222222222222222222222222222222222222";
const custodyAddress = "0x3333333333333333333333333333333333333333";
const sender = "0x4444444444444444444444444444444444444444";
const amount = 100n;
const depositEvents = new ethers.Interface([
  "event DepositRouted(address indexed token,uint256 amount,address indexed sender,address indexed stratoAddress,address targetStratoToken,uint96 depositId)",
]);
const transfers = new ethers.Interface([
  "event Transfer(address indexed from,address indexed to,uint256 amount)",
]);

const deposit = (overrides: Partial<DepositInfo> = {}): DepositInfo => ({
  bridgeStatus: "1",
  externalSender: sender,
  externalToken,
  requestedAt: "1",
  stratoRecipient: sender,
  stratoToken: "0x5555555555555555555555555555555555555555",
  stratoTokenAmount: amount.toString(),
  timestamp: "1",
  externalChainId: chainId,
  externalTxHash: "0xabc",
  depositId: "1",
  externalDecimals: 18,
  depositRouter,
  custodyAddress,
  ...overrides,
});

const detectedDeposit = (
  depositId: string,
  externalLogIndex: number,
  overrides: Partial<DepositArgs> = {},
): DepositArgs => ({
  externalChainId: chainId,
  depositRouter,
  depositId,
  externalSender: sender,
  externalToken,
  externalTokenAmount: amount.toString(),
  observedExternalTokenAmount: amount.toString(),
  externalTxHash: `0x${"ab".repeat(32)}`,
  externalBlockHash: `0x${"cd".repeat(32)}`,
  externalBlockNumber: 16,
  externalBlockTimestamp: 1,
  externalLogIndex,
  detectedAt: 2,
  stratoRecipient: "0x6666666666666666666666666666666666666666",
  targetStratoToken: "0x7777777777777777777777777777777777777777",
  ...overrides,
});

const transferLog = (
  logIndex: number,
  overrides: {
    token?: string;
    from?: string;
    to?: string;
    amount?: bigint;
  } = {},
) => {
  const encoded = transfers.encodeEventLog(transfers.getEvent("Transfer")!, [
    overrides.from || sender,
    overrides.to || custodyAddress,
    overrides.amount ?? amount,
  ]);
  return {
    address: overrides.token || externalToken,
    topics: encoded.topics,
    data: encoded.data,
    logIndex: ethers.toBeHex(logIndex),
  };
};

const ethTracePair = (
  traceIndex: number,
  depositSender = sender,
  value = amount,
) => [
  {
    type: "call",
    traceAddress: [traceIndex],
    action: { from: depositSender, to: depositRouter, value: ethers.toBeHex(value) },
  },
  {
    type: "call",
    traceAddress: [traceIndex, 0],
    action: { from: depositRouter, to: custodyAddress, value: ethers.toBeHex(value) },
  },
];

const depositReceiptLog = (value: DepositArgs) => {
  const encoded = depositEvents.encodeEventLog(
    depositEvents.getEvent("DepositRouted")!,
    [
      value.externalToken,
      BigInt(value.observedExternalTokenAmount),
      value.externalSender,
      value.stratoRecipient,
      value.targetStratoToken,
      BigInt(value.depositId),
    ],
  );
  return {
    address: value.depositRouter,
    topics: encoded.topics,
    data: encoded.data,
    logIndex: ethers.toBeHex(value.externalLogIndex),
  };
};

test("uniquely matches two distinct ERC-20 deposits and transfers", async () => {
  const { verifyTransactionCustody } = await verificationService;
  const deposits = [
    detectedDeposit("1", 1),
    detectedDeposit("2", 3, {
      externalTokenAmount: "200",
      observedExternalTokenAmount: "200",
    }),
  ];
  const receipt = {
    logs: [transferLog(0), transferLog(2, { amount: 200n })],
  };
  assert.equal(
    verifyTransactionCustody(deposits, receipt, [], custodyAddress),
    null,
  );
});

test("uniquely matches two equal ERC-20 deposits to two equal transfers", async () => {
  const { verifyTransactionCustody } = await verificationService;
  assert.equal(
    verifyTransactionCustody(
      [detectedDeposit("1", 1), detectedDeposit("2", 3)],
      { logs: [transferLog(0), transferLog(2)] },
      [],
      custodyAddress,
    ),
    null,
  );
});

test("rejects two deposits that share one custody transfer", async () => {
  const { verifyTransactionCustody } = await verificationService;
  assert.match(
    verifyTransactionCustody(
      [detectedDeposit("1", 1), detectedDeposit("2", 2)],
      { logs: [transferLog(0)] },
      [],
      custodyAddress,
    )?.message || "",
    /custody transfer missing/,
  );
});

test("invalidates every deposit in a transaction when one transfer is reused", async () => {
  process.env[`CHAIN_${chainId}_RPC_URL`] = "https://primary-rpc";
  const api = await import("../utils/api");
  const first = detectedDeposit("1", 1);
  const second = detectedDeposit("2", 2);
  let receiptRequests = 0;
  let traceRequests = 0;
  (api.fetch as any).post = async (_url: string, requests: any[]) =>
    requests.map((request) => {
      if (request.method === "eth_getTransactionReceipt") receiptRequests += 1;
      if (request.method === "trace_transaction") traceRequests += 1;
      return {
        id: request.id,
        result:
          request.method === "eth_getTransactionReceipt"
            ? {
                transactionHash: first.externalTxHash,
                blockHash: first.externalBlockHash,
                blockNumber: "0x10",
                status: "0x1",
                to: depositRouter,
                logs: [
                  transferLog(0),
                  depositReceiptLog(first),
                  depositReceiptLog(second),
                ],
              }
            : [],
      };
    });
  const { depositIdentity, verifyDetectedDepositsBatch } =
    await verificationService;
  const results = await verifyDetectedDepositsBatch(
    [first, second],
    16,
    custodyAddress,
  );
  assert.equal(results.get(depositIdentity(first))?.state, "invalid");
  assert.equal(results.get(depositIdentity(second))?.state, "invalid");
  assert.equal(receiptRequests, 1);
  assert.equal(traceRequests, 1);
});

test("rejects a duplicated deposit identity in the receipt", async () => {
  process.env[`CHAIN_${chainId}_RPC_URL`] = "https://primary-rpc";
  const api = await import("../utils/api");
  const first = detectedDeposit("1", 1);
  const duplicate = detectedDeposit("1", 3);
  (api.fetch as any).post = async (_url: string, requests: any[]) =>
    requests.map((request) => ({
      id: request.id,
      result:
        request.method === "eth_getTransactionReceipt"
          ? {
              transactionHash: first.externalTxHash,
              blockHash: first.externalBlockHash,
              blockNumber: "0x10",
              status: "0x1",
              to: depositRouter,
              logs: [
                transferLog(0),
                depositReceiptLog(first),
                transferLog(2),
                depositReceiptLog(duplicate),
              ],
            }
          : [],
    }));
  const { depositIdentity, verifyDetectedDepositsBatch } =
    await verificationService;
  const results = await verifyDetectedDepositsBatch(
    [first],
    16,
    custodyAddress,
  );
  const result = results.get(depositIdentity(first));
  assert.equal(result?.state, "invalid");
  assert.match(
    result?.state === "invalid" ? result.error.message : "",
    /Duplicate deposit identity/,
  );
});

for (const [label, overrides] of [
  ["sender", { from: "0x8888888888888888888888888888888888888888" }],
  ["token", { token: "0x8888888888888888888888888888888888888888" }],
  ["custody", { to: "0x8888888888888888888888888888888888888888" }],
  ["amount", { amount: 99n }],
] as const) {
  test(`rejects an ERC-20 custody transfer with the wrong ${label}`, async () => {
    const { verifyTransactionCustody } = await verificationService;
    assert.match(
      verifyTransactionCustody(
        [detectedDeposit("1", 1)],
        { logs: [transferLog(0, overrides)] },
        [],
        custodyAddress,
      )?.message || "",
      /custody transfer missing/,
    );
  });
}

test("verifies mixed ERC-20 and ETH deposits in one transaction", async () => {
  const { verifyTransactionCustody } = await verificationService;
  assert.equal(
    verifyTransactionCustody(
      [
        detectedDeposit("1", 1),
        detectedDeposit("2", 2, { externalToken: ZERO_ADDRESS }),
      ],
      { logs: [transferLog(0)] },
      ethTracePair(0),
      custodyAddress,
    ),
    null,
  );
});

test("verifies two equal ETH deposits batched by a smart wallet", async () => {
  const { verifyTransactionCustody } = await verificationService;
  const smartWallet = "0x8888888888888888888888888888888888888888";
  assert.equal(
    verifyTransactionCustody(
      [
        detectedDeposit("1", 1, {
          externalSender: smartWallet,
          externalToken: ZERO_ADDRESS,
        }),
        detectedDeposit("2", 2, {
          externalSender: smartWallet,
          externalToken: ZERO_ADDRESS,
        }),
      ],
      { logs: [] },
      [...ethTracePair(0, smartWallet), ...ethTracePair(1, smartWallet)],
      custodyAddress,
    ),
    null,
  );
});

test("deduplicates exact repeated custody logs from an RPC", async () => {
  const { verifyTransactionCustody } = await verificationService;
  const repeated = transferLog(0);
  assert.equal(
    verifyTransactionCustody(
      [detectedDeposit("1", 1)],
      { logs: [repeated, { ...repeated }] },
      [],
      custodyAddress,
    ),
    null,
  );
});

test("rejects reordered custody logs that make ownership ambiguous", async () => {
  const { verifyTransactionCustody } = await verificationService;
  assert.match(
    verifyTransactionCustody(
      [detectedDeposit("1", 2), detectedDeposit("2", 3)],
      { logs: [transferLog(0), transferLog(1)] },
      [],
      custodyAddress,
    )?.message || "",
    /Ambiguous ERC20 custody transfers/,
  );
});

test("rejects conflicting duplicate ETH traces", async () => {
  const { verifyTransactionCustody } = await verificationService;
  const traces = ethTracePair(0);
  traces.push({
    ...traces[1],
    action: { ...traces[1].action, value: ethers.toBeHex(101n) },
  });
  assert.match(
    verifyTransactionCustody(
      [detectedDeposit("1", 0, { externalToken: ZERO_ADDRESS })],
      { logs: [] },
      traces,
      custodyAddress,
    )?.message || "",
    /Conflicting ETH traces/,
  );
});

test("rejects reordered ETH traces that do not match deposit order", async () => {
  const { verifyTransactionCustody } = await verificationService;
  const otherSender = "0x8888888888888888888888888888888888888888";
  assert.match(
    verifyTransactionCustody(
      [
        detectedDeposit("1", 1, { externalToken: ZERO_ADDRESS }),
        detectedDeposit("2", 2, {
          externalSender: otherSender,
          externalToken: ZERO_ADDRESS,
          externalTokenAmount: "200",
          observedExternalTokenAmount: "200",
        }),
      ],
      { logs: [] },
      [
        ...ethTracePair(0, otherSender, 200n),
        ...ethTracePair(1, sender, 100n),
      ],
      custodyAddress,
    )?.message || "",
    /does not uniquely match/,
  );
});

test("verifies an ERC-20 transfer to the configured vault custody address", async () => {
  const { validateDeposit, verifyErc20Deposit } = await verificationService;
  const context = validateDeposit(deposit(), chainId);
  assert(!(context instanceof Error));

  const receipt = {
    logs: [
      {
        address: externalToken,
        topics: [
          TRANSFER_EVENT_SIGNATURE,
          ethers.zeroPadValue(sender, 32),
          ethers.zeroPadValue(custodyAddress, 32),
        ],
        data: ethers.zeroPadValue(ethers.toBeHex(amount), 32),
      },
    ],
  };

  assert.equal(verifyErc20Deposit(receipt, context), null);
});

test("rejects an ERC-20 transfer to a different custody address", async () => {
  const { validateDeposit, verifyErc20Deposit } = await verificationService;
  const context = validateDeposit(deposit(), chainId);
  assert(!(context instanceof Error));

  const receipt = {
    logs: [
      {
        address: externalToken,
        topics: [
          TRANSFER_EVENT_SIGNATURE,
          ethers.zeroPadValue(sender, 32),
          ethers.zeroPadValue(sender, 32),
        ],
        data: ethers.zeroPadValue(ethers.toBeHex(amount), 32),
      },
    ],
  };

  assert.match(
    verifyErc20Deposit(receipt, context)?.message || "",
    /No ERC20 Transfer to custody/,
  );
});

test("verifies the DepositRouter internal ETH transfer to vault custody", async () => {
  const { validateDeposit, verifyEthDeposit } = await verificationService;
  const context = validateDeposit(
    deposit({ externalToken: ZERO_ADDRESS }),
    chainId,
  );
  assert(!(context instanceof Error));

  const receipt = { to: depositRouter };
  const traces = [
    {
      type: "call",
      action: {
        to: custodyAddress,
        value: ethers.toBeHex(amount),
      },
    },
  ];

  assert.equal(verifyEthDeposit(receipt, traces, context), null);
});

test("fails closed when custody is missing from chain configuration", async () => {
  const { validateDeposit } = await verificationService;
  const result = validateDeposit(deposit({ custodyAddress: "" }), chainId);
  assert(result instanceof Error);
  assert.match(result.message, /Custody address not configured/);
});

test("marks inconsistent RPC receipts as disagreement", async () => {
  process.env[`CHAIN_${chainId}_RPC_URL`] = "https://primary-rpc";
  process.env[`CHAIN_${chainId}_VERIFICATION_RPC_URLS`] = "https://secondary-rpc";
  const api = await import("../utils/api");
  const txHash = `0x${"aa".repeat(32)}`;
  (api.fetch as any).post = async (url: string, requests: any[]) =>
    requests.map((request) => ({
      id: request.id,
      result: {
        transactionHash: txHash,
        blockHash:
          url === "https://primary-rpc"
            ? `0x${"11".repeat(32)}`
            : `0x${"22".repeat(32)}`,
        blockNumber: "0x10",
        status: "0x1",
        to: depositRouter,
        logs: [],
      },
    }));

  const { getTransactionReceiptsBatch } = await import("./rpcService");
  const receipts = await getTransactionReceiptsBatch(chainId, [txHash]);
  assert.equal(receipts.get(txHash)?.__rpcDisagreement, true);
  delete process.env[`CHAIN_${chainId}_VERIFICATION_RPC_URLS`];
});

test("restarts confirmation when a receipt is relocated by a reorg", async () => {
  process.env[`CHAIN_${chainId}_RPC_URL`] = "https://primary-rpc";
  const api = await import("../utils/api");
  const txHash = `0x${"bb".repeat(32)}`;
  (api.fetch as any).post = async (_url: string, requests: any[]) =>
    requests.map((request) => ({
      id: request.id,
      result: request.method === "eth_getTransactionReceipt"
        ? {
            transactionHash: txHash,
            blockHash: `0x${"11".repeat(32)}`,
            blockNumber: "0x10",
            status: "0x1",
            to: depositRouter,
            logs: [],
          }
        : [],
    }));
  const detected: DepositArgs = {
    externalChainId: chainId,
    depositRouter,
    depositId: "1",
    externalSender: "0x1111111111111111111111111111111111111111",
    externalToken,
    externalTokenAmount: "100",
    observedExternalTokenAmount: "100",
    externalTxHash: txHash,
    externalBlockHash: `0x${"22".repeat(32)}`,
    externalBlockNumber: 16,
    externalBlockTimestamp: 1,
    externalLogIndex: 0,
    detectedAt: 2,
    stratoRecipient: "0x6666666666666666666666666666666666666666",
    targetStratoToken: "0x7777777777777777777777777777777777777777",
  };

  const { depositIdentity, verifyDetectedDepositsBatch } =
    await verificationService;
  const results = await verifyDetectedDepositsBatch(
    [detected],
    20,
    custodyAddress,
  );
  assert.equal(results.get(depositIdentity(detected))?.state, "relocated");
});

test("treats a lagging secondary RPC as retryable missing data", async () => {
  process.env[`CHAIN_${chainId}_RPC_URL`] = "https://primary-rpc";
  process.env[`CHAIN_${chainId}_VERIFICATION_RPC_URLS`] = "https://lagging-rpc";
  const api = await import("../utils/api");
  const txHash = `0x${"cc".repeat(32)}`;
  (api.fetch as any).post = async (url: string, requests: any[]) =>
    requests.map((request) => ({
      id: request.id,
      result:
        url === "https://primary-rpc"
          ? {
              transactionHash: txHash,
              blockHash: `0x${"11".repeat(32)}`,
              blockNumber: "0x10",
              status: "0x1",
              to: depositRouter,
              logs: [],
            }
          : null,
    }));

  const { getTransactionReceiptsBatch } = await import("./rpcService");
  const receipts = await getTransactionReceiptsBatch(chainId, [txHash]);
  assert.equal(receipts.has(txHash), false);
  delete process.env[`CHAIN_${chainId}_VERIFICATION_RPC_URLS`];
});

test("normalizes hex casing when comparing RPC receipts", async () => {
  const { receiptFingerprint } = await import("./rpcService");
  const lower = {
    transactionHash: "0xabcd",
    blockHash: "0xcdef",
    blockNumber: "0xa",
    status: "0x1",
    to: "0xabcdef",
    logs: [{
      address: "0xabcdef",
      topics: ["0xabcd"],
      data: "0xcdef",
      logIndex: "0xa",
    }],
  };
  const upper = {
    transactionHash: "0xABCD",
    blockHash: "0xCDEF",
    blockNumber: "0xA",
    status: "0x1",
    to: "0xABCDEF",
    logs: [{
      address: "0xABCDEF",
      topics: ["0xABCD"],
      data: "0xCDEF",
      logIndex: "0xA",
    }],
  };
  assert.equal(receiptFingerprint(lower), receiptFingerprint(upper));
});

test("requests internal traces from the primary RPC only", async () => {
  process.env[`CHAIN_${chainId}_RPC_URL`] = "https://primary-rpc";
  process.env[`CHAIN_${chainId}_VERIFICATION_RPC_URLS`] = "https://secondary-rpc";
  const api = await import("../utils/api");
  const requestedUrls: string[] = [];
  (api.fetch as any).post = async (url: string, requests: any[]) => {
    requestedUrls.push(url);
    return requests.map((request) => ({ id: request.id, result: [] }));
  };

  const { getInternalTransactionsBatch } = await import("./rpcService");
  await getInternalTransactionsBatch(chainId, [`0x${"dd".repeat(32)}`]);
  assert.deepEqual(requestedUrls, ["https://primary-rpc"]);
  delete process.env[`CHAIN_${chainId}_VERIFICATION_RPC_URLS`];
});

test("accepts a router deposit invoked through a smart wallet", async () => {
  process.env[`CHAIN_${chainId}_RPC_URL`] = "https://primary-rpc";
  const api = await import("../utils/api");
  const txHash = `0x${"ee".repeat(32)}`;
  const blockHash = `0x${"44".repeat(32)}`;
  const sender = "0x6666666666666666666666666666666666666666";
  const recipient = "0x7777777777777777777777777777777777777777";
  const targetToken = "0x8888888888888888888888888888888888888888";
  const depositEvents = new ethers.Interface([
    "event DepositRouted(address indexed token,uint256 amount,address indexed sender,address indexed stratoAddress,address targetStratoToken,uint96 depositId)",
  ]);
  const transfers = new ethers.Interface([
    "event Transfer(address indexed from,address indexed to,uint256 amount)",
  ]);
  const depositLog = depositEvents.encodeEventLog(
    depositEvents.getEvent("DepositRouted")!,
    [externalToken, 100n, sender, recipient, targetToken, 1],
  );
  const transferLog = transfers.encodeEventLog(
    transfers.getEvent("Transfer")!,
    [sender, custodyAddress, 100n],
  );
  (api.fetch as any).post = async (_url: string, requests: any[]) =>
    requests.map((request) => ({
      id: request.id,
      result: {
        transactionHash: txHash,
        blockHash,
        blockNumber: "0x10",
        status: "0x1",
        to: "0x9999999999999999999999999999999999999999",
        logs: [
          {
            address: externalToken,
            topics: transferLog.topics,
            data: transferLog.data,
            logIndex: "0x0",
          },
          {
            address: depositRouter,
            topics: depositLog.topics,
            data: depositLog.data,
            logIndex: "0x1",
          },
        ],
      },
    }));
  const detected: DepositArgs = {
    externalChainId: chainId,
    depositRouter,
    depositId: "1",
    externalSender: sender,
    externalToken,
    externalTokenAmount: "100",
    observedExternalTokenAmount: "100",
    externalTxHash: txHash,
    externalBlockHash: blockHash,
    externalBlockNumber: 16,
    externalBlockTimestamp: 1,
    externalLogIndex: 1,
    detectedAt: 2,
    stratoRecipient: recipient,
    targetStratoToken: targetToken,
  };

  const { depositIdentity, verifyDetectedDepositsBatch } =
    await verificationService;
  const results = await verifyDetectedDepositsBatch(
    [detected],
    16,
    custodyAddress,
  );
  assert.equal(results.get(depositIdentity(detected))?.state, "verified");
});
