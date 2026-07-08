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

const transferSnapshot = readJson(join(snapshotDir, "event-Transfer.json"));

const config: WasConfig = {
  nodeUrl: "https://example.invalid",
  mercataBridge: "0000000000000000000000000000000000001008",
  stratoNativeBridge: "4d9e9c39180a75091b9c35bbb9064d67c7fdde5a",
  port: 3002,
  pollIntervalMs: 30_000,
  includeTerminalWithdrawals: true,
};

const token = "4444444444444444444444444444444444444444";
const owner = "3333333333333333333333333333333333333333";
const sender = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const makeTransfer = (
  value: string,
  blockNumber: string,
  transactionHash: string,
  overrides: Partial<CirrusEventRow> = {},
): CirrusEventRow => ({
  event_name: "Transfer",
  address: token,
  attributes: {
    from: sender,
    to: owner,
    value,
  },
  block_timestamp: "2026-01-01 00:00:00 UTC",
  block_number: blockNumber,
  transaction_hash: transactionHash,
  transaction_sender: sender,
  ...overrides,
});

const makeCursor = (amount: string, beforeBlock = "100"): TraceCursor => ({
  owner,
  token,
  amount,
  depth: 0,
  beforeEvent: makeTransfer("0", beforeBlock, "0xbefore"),
});

const createMockCirrusClient = (transferRows: CirrusEventRow[]) => {
  const requests: { table: string; params?: CirrusQueryParams }[] = [];

  const client: CirrusClient = {
    getRows: async <T>(table: string, params?: CirrusQueryParams) => {
      requests.push({ table, params });

      if (params?.event_name !== "eq.Transfer") {
        return [] as T[];
      }

      const requestedToken = String(params.address || "").replace(/^eq\./, "");
      const requestedOwner = String(params["attributes->>to"] || "").replace(/^eq\./, "");
      return transferRows.filter(
        (row) =>
          row.address === requestedToken &&
          row.attributes.to === requestedOwner,
      ) as T[];
    },
    verifyConnectivity: async () => undefined,
  };

  return { client, requests };
};

const sumLots = (lots: TraceLot[]): bigint =>
  lots.reduce((total, lot) => total + BigInt(lot.amount), 0n);

const assertLotShape = (lot: TraceLot) => {
  assert.equal(lot.owner, owner);
  assert.equal(lot.token, token);
  assert.equal(lot.source, "transfer");
  assert.equal(typeof lot.amount, "string");
  assert.equal(typeof lot.transactionHash, "string");
  assert.ok(lot.event, "expected source event on funding lot");
};

test("fetchFundingLots returns one transfer that fully covers cursor amount", async () => {
  const { client, requests } = createMockCirrusClient([
    makeTransfer("100", "99", "0xfull"),
  ]);
  const repository = createWithdrawalRepository(client, config);

  const lots = await repository.fetchFundingLots(makeCursor("100"));

  assert.equal(lots.length, 1);
  assert.equal(lots[0].amount, "100");
  assertLotShape(lots[0]);
  assert.equal(requests[0].table, "/event");
  assert.equal(requests[0].params?.address, `eq.${token}`);
  assert.equal(requests[0].params?.event_name, "eq.Transfer");
  assert.equal(requests[0].params?.["attributes->>to"], `eq.${owner}`);
  assert.equal(requests[0].params?.block_number, "lt.100");
  assert.equal(
    requests[0].params?.select,
    "event_name,address,attributes,block_timestamp,block_number,transaction_hash,transaction_sender",
  );
  assert.equal(requests[0].params?.order, "block_number.desc");
  assert.equal(requests[0].params?.limit, 100);
});

test("fetchFundingLots accumulates multiple transfers until cursor amount is covered", async () => {
  const { client } = createMockCirrusClient([
    makeTransfer("70", "99", "0xnewer"),
    makeTransfer("30", "98", "0xolder"),
  ]);
  const repository = createWithdrawalRepository(client, config);

  const lots = await repository.fetchFundingLots(makeCursor("100"));

  assert.equal(lots.length, 2);
  assert.equal(sumLots(lots).toString(), "100");
  assert.deepEqual(lots.map((lot) => lot.transactionHash), ["0xnewer", "0xolder"]);
});

test("fetchFundingLots partially consumes the last transfer", async () => {
  const { client } = createMockCirrusClient([
    makeTransfer("70", "99", "0xnewer"),
    makeTransfer("80", "98", "0xpartial"),
  ]);
  const repository = createWithdrawalRepository(client, config);

  const lots = await repository.fetchFundingLots(makeCursor("100"));

  assert.equal(lots.length, 2);
  assert.equal(lots[0].amount, "70");
  assert.equal(lots[1].amount, "30");
  assert.equal(sumLots(lots).toString(), "100");
});

test("fetchFundingLots returns empty when no matching transfers are found", async () => {
  const { client } = createMockCirrusClient([
    makeTransfer("100", "99", "0xwrong-owner", {
      attributes: {
        from: sender,
        to: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        value: "100",
      },
    }),
  ]);
  const repository = createWithdrawalRepository(client, config);

  const lots = await repository.fetchFundingLots(makeCursor("100"));

  assert.deepEqual(lots, []);
});

test("fetchFundingLots ignores transfers at or after cursor beforeEvent block", async () => {
  const { client } = createMockCirrusClient([
    makeTransfer("100", "101", "0xafter"),
    makeTransfer("100", "100", "0xsame-block"),
    makeTransfer("100", "99", "0xbefore"),
  ]);
  const repository = createWithdrawalRepository(client, config);

  const lots = await repository.fetchFundingLots(makeCursor("100", "100"));

  assert.equal(lots.length, 1);
  assert.equal(lots[0].transactionHash, "0xbefore");
});

test("live fetchFundingLots returns bounded lots for a known transfer cursor", async (t) => {
  if (process.env.WAS_RUN_LIVE_TESTS !== "true") {
    t.skip("set WAS_RUN_LIVE_TESTS=true to run live funding lot fetches");
    return;
  }

  const knownTransfer = transferSnapshot.sampleRows[0] as CirrusEventRow;
  const liveConfig = loadConfig();
  const repository = createWithdrawalRepository(
    createCirrusClient(liveConfig, createAccessTokenProvider(liveConfig)),
    liveConfig,
  );
  const beforeBlock = (BigInt(String(knownTransfer.block_number)) + 1n).toString();
  const cursor: TraceCursor = {
    owner: String(knownTransfer.attributes.to),
    token: knownTransfer.address,
    amount: String(knownTransfer.attributes.value),
    depth: 0,
    beforeEvent: {
      ...knownTransfer,
      block_number: beforeBlock,
    },
  };

  const lots = await repository.fetchFundingLots(cursor);

  assert.ok(lots.length > 0, "expected live funding lot for known transfer");
  assert.ok(sumLots(lots) <= BigInt(cursor.amount));
  for (const lot of lots) {
    assert.equal(typeof lot.amount, "string");
    assert.equal(typeof lot.transactionHash, "string");
    assert.ok(lot.event, "expected live lot event evidence");
  }
});
