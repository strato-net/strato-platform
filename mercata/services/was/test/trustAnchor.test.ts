/// <reference types="node" />

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import dotenv from "dotenv";
import { createAccessTokenProvider } from "../src/auth";
import { createCirrusClient } from "../src/cirrusClient";
import { loadConfig } from "../src/config";
import { createWithdrawalRepository } from "../src/withdrawalRepository";
import {
  CirrusClient,
  CirrusEventRow,
  CirrusQueryParams,
  TraceEdge,
  WasConfig,
} from "../src/types";

const wasRoot = resolve(__dirname, "..");
dotenv.config({ path: join(wasRoot, ".env") });
dotenv.config({ path: resolve(wasRoot, "../../backend/.env") });

const snapshotDir = join(wasRoot, "test/fixtures/schema-snapshot/current");
const readJson = <T = any>(path: string): T =>
  JSON.parse(readFileSync(path, "utf8"));
const standardDepositSnapshot = readJson(
  join(snapshotDir, "event-DepositCompleted.json"),
);
const nativeDepositSnapshot = readJson(
  join(snapshotDir, "event-NativeDepositCompleted.json"),
);

const owner = "3333333333333333333333333333333333333333";
const token = "4444444444444444444444444444444444444444";
const amount = "100";
const blockNumber = "99";
const transactionHash = "0xanchor";

const config: WasConfig = {
  nodeUrl: "https://example.invalid",
  mercataBridge: "0000000000000000000000000000000000001008",
  stratoNativeBridge: "4d9e9c39180a75091b9c35bbb9064d67c7fdde5a",
  port: 3002,
  pollIntervalMs: 30_000,
  includeTerminalWithdrawals: true,
};

const transferEvent = (value = amount): CirrusEventRow => ({
  event_name: "Transfer",
  address: token,
  attributes: {
    from: "0000000000000000000000000000000000000000",
    to: owner,
    value,
  },
  block_timestamp: "2026-01-01 00:00:00 UTC",
  block_number: blockNumber,
  transaction_hash: transactionHash,
  transaction_sender: owner,
});

const depositEvent = (
  eventName: "DepositCompleted" | "NativeDepositCompleted",
  overrides: Partial<CirrusEventRow["attributes"]> = {},
): CirrusEventRow => ({
  event_name: eventName,
  address:
    eventName === "DepositCompleted"
      ? config.mercataBridge
      : config.stratoNativeBridge,
  attributes: {
    externalChainId: "1",
    externalSender: owner,
    externalTxHash: "0xexternal",
    stratoRecipient: owner,
    stratoToken: token,
    stratoTokenAmount: amount,
    ...(eventName === "NativeDepositCompleted"
      ? {
          depositId: "deposit-id",
          externalBridge: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          externalRedemptionId: "1",
        }
      : {}),
    ...overrides,
  },
  block_timestamp: "2026-01-01 00:00:00 UTC",
  block_number: blockNumber,
  transaction_hash: transactionHash,
  transaction_sender: owner,
});

const edge = (value = amount): TraceEdge => ({
  type: "transfer",
  to: {
    owner,
    token,
    amount,
    source: "transfer",
    transactionHash,
    blockNumber,
    event: transferEvent(value),
  },
  event: transferEvent(value),
  result: "info",
  explanation: "Transfer lot traces backward to the sender.",
});

const createMockCirrusClient = (rows: CirrusEventRow[]) => {
  const requests: { table: string; params?: CirrusQueryParams }[] = [];
  const client: CirrusClient = {
    getRows: async <T>(table: string, params?: CirrusQueryParams) => {
      requests.push({ table, params });
      return rows.filter(
        (row) =>
          row.block_number === String(params?.block_number).replace(/^eq\./, "") &&
          row.transaction_hash === String(params?.transaction_hash).replace(/^eq\./, ""),
      ) as T[];
    },
    verifyConnectivity: async () => undefined,
  };

  return { client, requests };
};

test("fetchTrustAnchor returns standard bridge deposit anchor", async () => {
  const { client } = createMockCirrusClient([depositEvent("DepositCompleted")]);
  const repository = createWithdrawalRepository(client, config);

  const anchor = await repository.fetchTrustAnchor(edge());

  assert.ok(anchor);
  assert.equal(anchor.type, "MercataBridge.DepositCompleted");
  assert.equal(anchor.owner, owner);
  assert.equal(anchor.token, token);
  assert.equal(anchor.amount, amount);
  assert.equal(anchor.event.event_name, "DepositCompleted");
});

test("fetchTrustAnchor returns native bridge deposit anchor", async () => {
  const { client } = createMockCirrusClient([
    depositEvent("NativeDepositCompleted"),
  ]);
  const repository = createWithdrawalRepository(client, config);

  const anchor = await repository.fetchTrustAnchor(edge());

  assert.ok(anchor);
  assert.equal(anchor.type, "StratoNativeBridge.NativeDepositCompleted");
  assert.equal(anchor.owner, owner);
  assert.equal(anchor.token, token);
  assert.equal(anchor.amount, amount);
  assert.equal(anchor.event.event_name, "NativeDepositCompleted");
});

test("fetchTrustAnchor queries same transaction bridge deposit events", async () => {
  const { client, requests } = createMockCirrusClient([
    depositEvent("DepositCompleted"),
  ]);
  const repository = createWithdrawalRepository(client, config);

  await repository.fetchTrustAnchor(edge());

  assert.equal(requests.length, 1);
  assert.equal(requests[0].table, "/event");
  assert.equal(requests[0].params?.block_number, `eq.${blockNumber}`);
  assert.equal(requests[0].params?.transaction_hash, `eq.${transactionHash}`);
  assert.equal(
    requests[0].params?.event_name,
    "in.(DepositCompleted,NativeDepositCompleted)",
  );
  assert.equal(
    requests[0].params?.select,
    "event_name,address,attributes,block_timestamp,block_number,transaction_hash,transaction_sender",
  );
  assert.equal(requests[0].params?.limit, 10);
});

test("fetchTrustAnchor rejects similar deposit with wrong recipient token or amount", async () => {
  for (const badAnchor of [
    depositEvent("DepositCompleted", {
      stratoRecipient: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }),
    depositEvent("DepositCompleted", {
      stratoToken: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }),
    depositEvent("DepositCompleted", {
      stratoTokenAmount: "99",
    }),
  ]) {
    const { client } = createMockCirrusClient([badAnchor]);
    const repository = createWithdrawalRepository(client, config);

    assert.equal(await repository.fetchTrustAnchor(edge()), null);
  }
});

test("fetchTrustAnchor accepts a partial lot backed by a larger deposit transfer", async () => {
  const { client } = createMockCirrusClient([
    depositEvent("DepositCompleted", { stratoTokenAmount: "1000" }),
  ]);
  const repository = createWithdrawalRepository(client, config);

  const anchor = await repository.fetchTrustAnchor(edge("1000"));

  assert.ok(anchor);
  assert.equal(anchor.amount, amount);
});

test("live fetchTrustAnchor returns anchor for known deposit events", async (t) => {
  if (process.env.WAS_RUN_LIVE_TESTS !== "true") {
    t.skip("set WAS_RUN_LIVE_TESTS=true to run live trust anchor fetches");
    return;
  }

  const liveConfig = loadConfig();
  const repository = createWithdrawalRepository(
    createCirrusClient(liveConfig, createAccessTokenProvider(liveConfig)),
    liveConfig,
  );

  for (const { event: anchorEvent, type } of [
    {
      event: standardDepositSnapshot.sampleRows[0] as CirrusEventRow,
      type: "MercataBridge.DepositCompleted",
    },
    {
      event: nativeDepositSnapshot.sampleRows[0] as CirrusEventRow,
      type: "StratoNativeBridge.NativeDepositCompleted",
    },
  ]) {
    const liveEdge: TraceEdge = {
      type: "transfer",
      to: {
        owner: String(anchorEvent.attributes.stratoRecipient),
        token: String(anchorEvent.attributes.stratoToken),
        amount: String(anchorEvent.attributes.stratoTokenAmount),
        source: "transfer",
      },
      event: anchorEvent,
      result: "info",
      explanation: "Synthetic live edge for anchor lookup.",
    };

    const anchor = await repository.fetchTrustAnchor(liveEdge);
    assert.ok(anchor);
    assert.equal(anchor.type, type);
  }
});
