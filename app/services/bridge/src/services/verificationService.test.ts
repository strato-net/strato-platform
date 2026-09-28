import "../test/setupEnv";
import assert from "node:assert/strict";
import test from "node:test";
import { config, TRANSFER_EVENT_SIGNATURE } from "../config";
import { DepositInfo } from "../types";
import { cirrus, fetch as httpClient } from "../utils/api";
import { verifyDepositsBatch } from "./verificationService";

const CHAIN_ID = 998;
process.env[`CHAIN_${CHAIN_ID}_RPC_URL`] = "http://localhost:1/unused";

const SAFE = "0x8c458f866e603335ef179a63a2528f357732f5d5";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const ROUTER = "0xc3be40e5eae865d6d80ec334f009eb1bdd107e1b";
const pad = (hex: string) => `0x${hex.replace(/^0x/, "").padStart(64, "0")}`;

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
    to: ROUTER,
    logs: [1_000_000, 2_000_000].map((amount) => ({
      address: USDC,
      topics: [TRANSFER_EVENT_SIGNATURE, pad("1111111111111111111111111111111111111111"), pad(SAFE)],
      data: pad(amount.toString(16)),
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
