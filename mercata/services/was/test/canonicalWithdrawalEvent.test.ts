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
  WasConfig,
} from "../src/types";

const wasRoot = resolve(__dirname, "..");
dotenv.config({ path: join(wasRoot, ".env") });
dotenv.config({ path: resolve(wasRoot, "../../backend/.env") });

const snapshotDir = join(wasRoot, "test/fixtures/schema-snapshot/current");

const readJson = <T = any>(path: string): T =>
  JSON.parse(readFileSync(path, "utf8"));

const standardWithdrawalSnapshot = readJson(
  join(snapshotDir, "mercataBridge-withdrawals.json"),
);
const nativeWithdrawalSnapshot = readJson(
  join(snapshotDir, "stratoNativeBridge-withdrawals.json"),
);
const standardEventSnapshot = readJson(
  join(snapshotDir, "event-WithdrawalRequested.json"),
);
const nativeEventSnapshot = readJson(
  join(snapshotDir, "event-NativeWithdrawalRequested.json"),
);

const config: WasConfig = {
  nodeUrl: "https://example.invalid",
  mercataBridge: "0000000000000000000000000000000000001008",
  stratoNativeBridge: "4d9e9c39180a75091b9c35bbb9064d67c7fdde5a",
  port: 3002,
  pollIntervalMs: 30_000,
  includeTerminalWithdrawals: true,
};

const normalizeFromStandardRow = (row: any) => ({
  routeType: "standard" as const,
  withdrawalId: String(row.key),
  bridgeStatus: String(row.value.bridgeStatus),
  stratoSender: row.value.stratoSender,
  stratoToken: row.value.stratoToken,
  stratoTokenAmount: row.value.stratoTokenAmount,
  externalChainId: String(row.value.externalChainId),
  externalRecipient: row.value.externalRecipient,
});

const normalizeFromNativeRow = (row: any) => ({
  routeType: "native" as const,
  withdrawalId: String(row.key),
  bridgeStatus: String(row.value.bridgeStatus),
  stratoSender: row.value.stratoSender,
  stratoToken: row.value.stratoToken,
  stratoTokenAmount: row.value.stratoTokenAmount,
  externalChainId: String(row.value.externalChainId),
  externalRecipient: row.value.externalRecipient,
});

const assertCanonicalEventShape = (
  event: CirrusEventRow | null,
  eventName: string,
) => {
  assert.ok(event, `expected ${eventName}`);
  assert.equal(event.event_name, eventName);
  assert.equal(typeof event.address, "string");
  assert.equal(typeof event.attributes, "object");
  assert.equal(typeof event.block_number, "string");
  assert.equal(typeof event.transaction_hash, "string");
  assert.equal(typeof event.transaction_sender, "string");
};

const createMockCirrusClient = () => {
  const requests: { table: string; params?: CirrusQueryParams }[] = [];
  const rowsByEventName: Record<string, CirrusEventRow[]> = {
    WithdrawalRequested: standardEventSnapshot.sampleRows,
    NativeWithdrawalRequested: nativeEventSnapshot.sampleRows,
  };

  const client: CirrusClient = {
    getRows: async <T>(table: string, params?: CirrusQueryParams) => {
      requests.push({ table, params });
      const eventName = String(params?.event_name || "").replace(/^eq\./, "");
      const withdrawalId = String(params?.["attributes->>withdrawalId"] || "")
        .replace(/^eq\./, "");
      const rows = rowsByEventName[eventName] || [];
      return rows
        .filter((row) => String(row.attributes.withdrawalId) === withdrawalId)
        .slice(0, Number(params?.limit || 1)) as T[];
    },
    verifyConnectivity: async () => undefined,
  };

  return { client, requests };
};

test("fetchCanonicalWithdrawalEvent queries standard withdrawal event by id", async () => {
  const event = standardEventSnapshot.sampleRows[0];
  const withdrawal = normalizeFromStandardRow({
    key: event.attributes.withdrawalId,
    value: {
      bridgeStatus: "3",
      stratoSender: event.attributes.user,
      stratoToken: event.attributes.token,
      stratoTokenAmount: event.attributes.stratoTokenAmount,
      externalChainId: event.attributes.destChainId,
      externalRecipient: event.attributes.dest,
    },
  });
  const { client, requests } = createMockCirrusClient();
  const repository = createWithdrawalRepository(client, config);

  const result = await repository.fetchCanonicalWithdrawalEvent(withdrawal);

  assertCanonicalEventShape(result, "WithdrawalRequested");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].table, "/event");
  assert.equal(requests[0].params?.address, `eq.${config.mercataBridge}`);
  assert.equal(requests[0].params?.event_name, "eq.WithdrawalRequested");
  assert.equal(
    requests[0].params?.["attributes->>withdrawalId"],
    `eq.${withdrawal.withdrawalId}`,
  );
  assert.equal(
    requests[0].params?.select,
    "event_name,address,attributes,block_timestamp,block_number,transaction_hash,transaction_sender",
  );
  assert.equal(requests[0].params?.order, "block_number.desc");
  assert.equal(requests[0].params?.limit, 1);
});

test("fetchCanonicalWithdrawalEvent queries native withdrawal event by id", async () => {
  const event = nativeEventSnapshot.sampleRows[0];
  const withdrawal = normalizeFromNativeRow({
    key: event.attributes.withdrawalId,
    value: {
      bridgeStatus: "3",
      stratoSender: event.attributes.stratoSender,
      stratoToken: event.attributes.stratoToken,
      stratoTokenAmount: event.attributes.stratoTokenAmount,
      externalChainId: event.attributes.externalChainId,
      externalRecipient: event.attributes.externalRecipient,
    },
  });
  const { client, requests } = createMockCirrusClient();
  const repository = createWithdrawalRepository(client, config);

  const result = await repository.fetchCanonicalWithdrawalEvent(withdrawal);

  assertCanonicalEventShape(result, "NativeWithdrawalRequested");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].table, "/event");
  assert.equal(requests[0].params?.address, `eq.${config.stratoNativeBridge}`);
  assert.equal(requests[0].params?.event_name, "eq.NativeWithdrawalRequested");
  assert.equal(
    requests[0].params?.["attributes->>withdrawalId"],
    `eq.${withdrawal.withdrawalId}`,
  );
});

test("fetchCanonicalWithdrawalEvent returns null when no matching event exists", async () => {
  const withdrawal = normalizeFromStandardRow(standardWithdrawalSnapshot.sampleRows[0]);
  const { client } = createMockCirrusClient();
  const repository = createWithdrawalRepository(client, config);

  const result = await repository.fetchCanonicalWithdrawalEvent({
    ...withdrawal,
    withdrawalId: "999999999",
  });

  assert.equal(result, null);
});

test("live fetchCanonicalWithdrawalEvent returns event shape for known snapshots", async (t) => {
  if (process.env.WAS_RUN_LIVE_TESTS !== "true") {
    t.skip("set WAS_RUN_LIVE_TESTS=true to run live canonical event fetches");
    return;
  }

  const liveConfig = loadConfig();
  const repository = createWithdrawalRepository(
    createCirrusClient(liveConfig, createAccessTokenProvider(liveConfig)),
    liveConfig,
  );

  const standardEvent = standardEventSnapshot.sampleRows[0];
  const nativeEvent = nativeEventSnapshot.sampleRows[0];
  const standard = normalizeFromStandardRow({
    key: standardEvent.attributes.withdrawalId,
    value: {
      bridgeStatus: "3",
      stratoSender: standardEvent.attributes.user,
      stratoToken: standardEvent.attributes.token,
      stratoTokenAmount: standardEvent.attributes.stratoTokenAmount,
      externalChainId: standardEvent.attributes.destChainId,
      externalRecipient: standardEvent.attributes.dest,
    },
  });
  const native = normalizeFromNativeRow({
    key: nativeEvent.attributes.withdrawalId,
    value: {
      bridgeStatus: "3",
      stratoSender: nativeEvent.attributes.stratoSender,
      stratoToken: nativeEvent.attributes.stratoToken,
      stratoTokenAmount: nativeEvent.attributes.stratoTokenAmount,
      externalChainId: nativeEvent.attributes.externalChainId,
      externalRecipient: nativeEvent.attributes.externalRecipient,
    },
  });

  assertCanonicalEventShape(
    await repository.fetchCanonicalWithdrawalEvent(standard),
    "WithdrawalRequested",
  );
  assertCanonicalEventShape(
    await repository.fetchCanonicalWithdrawalEvent(native),
    "NativeWithdrawalRequested",
  );
});
