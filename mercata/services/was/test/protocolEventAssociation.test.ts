/// <reference types="node" />

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import dotenv from "dotenv";
import { createAccessTokenProvider } from "../src/auth";
import { createCirrusClient } from "../src/cirrusClient";
import { loadConfig } from "../src/config";
import { PROTOCOL_ASSOCIATION_EVENT_NAMES } from "../src/protocolEventConfig";
import { createWithdrawalRepository } from "../src/withdrawalRepository";
import {
  CirrusClient,
  CirrusEventRow,
  CirrusQueryParams,
  TraceCursor,
  TraceLot,
  WasConfig,
} from "../src/types";

const wasRoot = resolve(__dirname, "..");
dotenv.config({ path: join(wasRoot, ".env") });
dotenv.config({ path: resolve(wasRoot, "../../backend/.env") });

const snapshotDir = join(wasRoot, "test/fixtures/schema-snapshot/current");
const readJson = <T = any>(path: string): T =>
  JSON.parse(readFileSync(path, "utf8"));
const swapSnapshot = readJson(join(snapshotDir, "event-Swap.json"));

const token = "4444444444444444444444444444444444444444";
const owner = "3333333333333333333333333333333333333333";
const amount = "100";
const blockNumber = "99";
const transactionHash = "0xprotocol";

const config: WasConfig = {
  nodeUrl: "https://example.invalid",
  mercataBridge: "0000000000000000000000000000000000001008",
  stratoNativeBridge: "4d9e9c39180a75091b9c35bbb9064d67c7fdde5a",
  port: 3002,
  pollIntervalMs: 30_000,
  includeTerminalWithdrawals: true,
};

const makeTransfer = (): CirrusEventRow => ({
  event_name: "Transfer",
  address: token,
  attributes: {
    from: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    to: owner,
    value: amount,
  },
  block_timestamp: "2026-01-01 00:00:00 UTC",
  block_number: blockNumber,
  transaction_hash: transactionHash,
  transaction_sender: owner,
});

const makeCursor = (): TraceCursor => ({
  owner,
  token,
  amount,
  depth: 0,
  beforeEvent: {
    ...makeTransfer(),
    block_number: "100",
    transaction_hash: "0xbefore",
  },
});

const makeProtocolEvent = (
  eventName: string,
  attributes: CirrusEventRow["attributes"],
): CirrusEventRow => ({
  event_name: eventName,
  address: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  attributes,
  block_timestamp: "2026-01-01 00:00:00 UTC",
  block_number: blockNumber,
  transaction_hash: transactionHash,
  transaction_sender: owner,
});

const protocolCases: {
  eventName: string;
  source: TraceLot["source"];
  attributes: CirrusEventRow["attributes"];
}[] = [
  {
    eventName: "Swap",
    source: "swap",
    attributes: {
      sender: owner,
      tokenIn: "cccccccccccccccccccccccccccccccccccccccc",
      amountIn: "110",
      tokenOut: token,
      amountOut: amount,
    },
  },
  {
    eventName: "MetalMinted",
    source: "metal_mint",
    attributes: {
      buyer: owner,
      payToken: "cccccccccccccccccccccccccccccccccccccccc",
      payAmount: "110",
      metalToken: token,
      metalAmount: amount,
      metalPrice: "1",
      feeAmount: "0",
      totalMinted: amount,
    },
  },
  {
    eventName: "USDSTMinted",
    source: "cdp_mint",
    attributes: {
      user: owner,
      asset: "cccccccccccccccccccccccccccccccccccccccc",
      amountUSD: amount,
      totalScaledDebt: amount,
      rateAccumulator: "1",
    },
  },
  {
    eventName: "DirectPSMMinted",
    source: "psm",
    attributes: {
      user: owner,
      depositAmount: "110",
      mintAmount: amount,
      againstToken: "cccccccccccccccccccccccccccccccccccccccc",
    },
  },
  {
    eventName: "RewardsClaimed",
    source: "rewards",
    attributes: {
      user: owner,
      amount,
    },
  },
];

const createMockCirrusClient = (protocolRows: CirrusEventRow[]) => {
  const requests: { table: string; params?: CirrusQueryParams }[] = [];
  const transfer = makeTransfer();

  const client: CirrusClient = {
    getRows: async <T>(table: string, params?: CirrusQueryParams) => {
      requests.push({ table, params });

      if (params?.event_name === "eq.Transfer") {
        return [transfer] as T[];
      }

      if (String(params?.event_name || "").startsWith("in.")) {
        return protocolRows.filter(
          (row) =>
            row.block_number === String(params?.block_number).replace(/^eq\./, "") &&
            row.transaction_hash === String(params?.transaction_hash).replace(/^eq\./, ""),
        ) as T[];
      }

      return [] as T[];
    },
    verifyConnectivity: async () => undefined,
  };

  return { client, requests };
};

test("fetchFundingLots replaces transfer with matching same-transaction protocol event", async () => {
  for (const { eventName, source, attributes } of protocolCases) {
    const protocolEvent = makeProtocolEvent(eventName, attributes);
    const { client } = createMockCirrusClient([protocolEvent]);
    const repository = createWithdrawalRepository(client, config);

    const lots = await repository.fetchFundingLots(makeCursor());

    assert.equal(lots.length, 1);
    assert.equal(lots[0].source, source);
    assert.equal(lots[0].event?.event_name, eventName);
    assert.equal(lots[0].transactionHash, transactionHash);
    assert.equal(lots[0].amount, amount);
  }
});

test("fetchFundingLots queries protocol events by same block and transaction", async () => {
  const { client, requests } = createMockCirrusClient([
    makeProtocolEvent("Swap", protocolCases[0].attributes),
  ]);
  const repository = createWithdrawalRepository(client, config);

  await repository.fetchFundingLots(makeCursor());

  const protocolRequest = requests.find((request) =>
    String(request.params?.event_name || "").startsWith("in."),
  );
  assert.ok(protocolRequest, "expected protocol event lookup");
  assert.equal(protocolRequest.table, "/event");
  assert.equal(protocolRequest.params?.block_number, `eq.${blockNumber}`);
  assert.equal(protocolRequest.params?.transaction_hash, `eq.${transactionHash}`);
  assert.equal(
    protocolRequest.params?.event_name,
    `in.(${PROTOCOL_ASSOCIATION_EVENT_NAMES.join(",")})`,
  );
  assert.equal(
    protocolRequest.params?.select,
    "event_name,address,attributes,block_timestamp,block_number,transaction_hash,transaction_sender",
  );
  assert.equal(protocolRequest.params?.limit, 25);
});

test("fetchFundingLots keeps transfer when protocol event does not match output", async () => {
  const mismatch = makeProtocolEvent("Swap", {
    sender: owner,
    tokenIn: "cccccccccccccccccccccccccccccccccccccccc",
    amountIn: "110",
    tokenOut: token,
    amountOut: "99",
  });
  const { client } = createMockCirrusClient([mismatch]);
  const repository = createWithdrawalRepository(client, config);

  const lots = await repository.fetchFundingLots(makeCursor());

  assert.equal(lots.length, 1);
  assert.equal(lots[0].source, "transfer");
  assert.equal(lots[0].event?.event_name, "Transfer");
});

test("fetchFundingLots keeps transfer when no protocol event exists", async () => {
  const { client } = createMockCirrusClient([]);
  const repository = createWithdrawalRepository(client, config);

  const lots = await repository.fetchFundingLots(makeCursor());

  assert.equal(lots.length, 1);
  assert.equal(lots[0].source, "transfer");
  assert.equal(lots[0].event?.event_name, "Transfer");
});

test("live fetchFundingLots maps known swap output transfer when available", async (t) => {
  if (process.env.WAS_RUN_LIVE_TESTS !== "true") {
    t.skip("set WAS_RUN_LIVE_TESTS=true to run live protocol association fetches");
    return;
  }

  const swap = swapSnapshot.sampleRows[0] as CirrusEventRow | undefined;
  if (!swap) {
    t.skip("generated swap snapshot does not contain a sample row");
    return;
  }

  const liveConfig = loadConfig();
  const repository = createWithdrawalRepository(
    createCirrusClient(liveConfig, createAccessTokenProvider(liveConfig)),
    liveConfig,
  );
  const beforeBlock = (BigInt(String(swap.block_number)) + 1n).toString();

  const lots = await repository.fetchFundingLots({
    owner: String(swap.attributes.sender),
    token: String(swap.attributes.tokenOut),
    amount: String(swap.attributes.amountOut),
    depth: 0,
    beforeEvent: {
      ...swap,
      block_number: beforeBlock,
      transaction_hash: "0xbefore",
    },
  });

  assert.ok(lots.length > 0, "expected live lot for known swap output");
  assert.equal(lots[0].source, "swap");
  assert.equal(lots[0].event?.event_name, "Swap");
});
