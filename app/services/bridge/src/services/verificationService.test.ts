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
  "SAFE_PROPOSER_PRIVATE_KEY",
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
            address: depositRouter,
            topics: depositLog.topics,
            data: depositLog.data,
            logIndex: "0x0",
          },
          {
            address: externalToken,
            topics: transferLog.topics,
            data: transferLog.data,
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
    externalLogIndex: 0,
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
