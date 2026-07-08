/// <reference types="node" />

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSnapshotBackedCirrusClient } from "../src/localEventStore";
import { CirrusClient, CirrusEventRow, WasConfig } from "../src/types";

const makeSnapshot = (rows: CirrusEventRow[]): string => {
  const dir = mkdtempSync(join(tmpdir(), "was-event-snapshot-"));
  writeFileSync(
    join(dir, "page-00000.jsonl"),
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify(
      {
        totalRows: rows.length,
        files: [{ file: "page-00000.jsonl", rowCount: rows.length }],
      },
      null,
      2,
    ),
  );
  return dir;
};

const transfer = (
  value: string,
  block: string,
  tx: string,
): CirrusEventRow => ({
  event_name: "Transfer",
  address: "token",
  attributes: {
    to: "owner",
    from: "sender",
    value,
  },
  block_number: block,
  block_timestamp: "2026-01-01 00:00:00 UTC",
  transaction_hash: tx,
  transaction_sender: "sender",
});

const config = (snapshotDir?: string): WasConfig => ({
  nodeUrl: "https://example.invalid",
  mercataBridge: "bridge",
  stratoNativeBridge: "native",
  port: 3002,
  pollIntervalMs: 3_600_000,
  includeTerminalWithdrawals: true,
  eventSnapshotDir: snapshotDir,
});

const baseClient = (): { client: CirrusClient; calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    client: {
      getRows: async (table) => {
        calls.push(table);
        return [{ table }] as any[];
      },
      verifyConnectivity: async () => undefined,
    },
  };
};

test("snapshot-backed client serves transfer funding queries locally", async () => {
  const snapshotDir = makeSnapshot([
    transfer("10", "1", "tx1"),
    transfer("20", "2", "tx2"),
    transfer("30", "3", "tx3"),
  ]);
  const { client, calls } = baseClient();
  const wrapped = createSnapshotBackedCirrusClient(client, config(snapshotDir));

  const rows = await wrapped.getRows<CirrusEventRow>("/event", {
    address: "eq.token",
    event_name: "eq.Transfer",
    "attributes->>to": "eq.owner",
    block_number: "lt.3",
    order: "block_number.desc",
    limit: 10,
  });

  assert.deepEqual(rows.map((row) => row.transaction_hash), ["tx2", "tx1"]);
  assert.deepEqual(calls, []);
});

test("snapshot-backed client serves same-transaction queries locally", async () => {
  const snapshotDir = makeSnapshot([
    transfer("10", "1", "tx1"),
    {
      event_name: "Swap",
      address: "pool",
      attributes: {
        sender: "owner",
        tokenIn: "in",
        tokenOut: "token",
        amountIn: "11",
        amountOut: "10",
      },
      block_number: "1",
      transaction_hash: "tx1",
      transaction_sender: "owner",
    },
  ]);
  const { client, calls } = baseClient();
  const wrapped = createSnapshotBackedCirrusClient(client, config(snapshotDir));

  const rows = await wrapped.getRows<CirrusEventRow>("/event", {
    block_number: "eq.1",
    transaction_hash: "eq.tx1",
    event_name: "in.(Swap,Transfer)",
    limit: 10,
  });

  assert.deepEqual(rows.map((row) => row.event_name), ["Transfer", "Swap"]);
  assert.deepEqual(calls, []);
});

test("snapshot-backed client delegates non-event tables to base client", async () => {
  const snapshotDir = makeSnapshot([]);
  const { client, calls } = baseClient();
  const wrapped = createSnapshotBackedCirrusClient(client, config(snapshotDir));

  const rows = await wrapped.getRows<any>("/BlockApps-MercataBridge-withdrawals");

  assert.deepEqual(rows, [{ table: "/BlockApps-MercataBridge-withdrawals" }]);
  assert.deepEqual(calls, ["/BlockApps-MercataBridge-withdrawals"]);
});

