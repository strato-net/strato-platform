/// <reference types="node" />

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSnapshotBackedCirrusClient } from "../src/localEventStore";
import { CirrusClient, CirrusEventRow, WasConfig } from "../src/types";

const writeSnapshot = (dir: string, rows: CirrusEventRow[]) => {
  const rowsByBlock = new Map<string, CirrusEventRow[]>();
  for (const row of rows) {
    const block = String(row.block_number || "0");
    rowsByBlock.set(block, [...(rowsByBlock.get(block) || []), row]);
  }
  const files = [...rowsByBlock.entries()].map(([block, blockRows]) => {
    const rangeDir = blockRangeDir(block);
    const file = `${rangeDir}/block-${block}.jsonl`;
    mkdirSync(join(dir, rangeDir), { recursive: true });
    writeFileSync(
      join(dir, file),
      blockRows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
    return {
      block,
      file,
      rowCount: blockRows.length,
    };
  });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify(
      {
        totalRows: rows.length,
        highestBlock: files[files.length - 1]?.block || "0",
        files,
      },
      null,
      2,
    ),
  );
};

const blockRangeDir = (block: string): string => {
  const blockNumber = BigInt(block || "0");
  if (blockNumber <= 0n) return "0-0";

  return [10000n, 1000n, 100n, 10n].map((span) => {
    const start = ((blockNumber - 1n) / span) * span + 1n;
    const end = start + span - 1n;
    return `${start.toString()}-${end.toString()}`;
  }).join("/");
};

const makeSnapshot = (rows: CirrusEventRow[]): string => {
  const dir = mkdtempSync(join(tmpdir(), "was-event-snapshot-"));
  writeSnapshot(dir, rows);
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

const baseClient = (
  eventRows: CirrusEventRow[] = [],
): { client: CirrusClient; calls: { table: string; params?: any }[] } => {
  const calls: { table: string; params?: any }[] = [];
  return {
    calls,
    client: {
      getRows: async (table, params) => {
        calls.push({ table, params });
        if (table === "/event") {
          const blockEq =
            typeof params?.block_number === "string" && params.block_number.startsWith("eq.")
              ? params.block_number.slice(3)
              : undefined;
          const filteredRows = blockEq
            ? eventRows.filter((row) => String(row.block_number) === blockEq)
            : eventRows;
          const offset = Number(params?.offset || 0);
          const limit = Number(params?.limit || filteredRows.length);
          return filteredRows.slice(offset, offset + limit) as any[];
        }
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

  const rows = await wrapped.getRows<any>("/not-event");

  assert.deepEqual(rows, [{ table: "/not-event" }]);
  assert.deepEqual(calls.map((call) => call.table), ["/not-event"]);
});

test("snapshot-backed client refreshes block files before withdrawal candidate queries", async () => {
  process.env.WAS_EVENT_SNAPSHOT_LATEST_BLOCK = "3";
  const snapshotDir = makeSnapshot([
    transfer("10", "1", "tx1"),
  ]);
  const { client, calls } = baseClient([
    transfer("20", "2", "tx2"),
    transfer("30", "3", "tx3"),
  ]);
  const wrapped = createSnapshotBackedCirrusClient(client, config(snapshotDir));

  try {
    await wrapped.getRows<any>("/BlockApps-MercataBridge-withdrawals");
    const rows = await wrapped.getRows<CirrusEventRow>("/event", {
      block_number: "gt.1",
      limit: 10,
    });
    const manifest = JSON.parse(
      readFileSync(join(snapshotDir, "manifest.json"), "utf8"),
    );

    assert.deepEqual(calls.map((call) => call.table), [
      "/event",
      "/event",
      "/BlockApps-MercataBridge-withdrawals",
    ]);
    assert.deepEqual(
      calls.slice(0, 2).map((call) => call.params.block_number),
      ["eq.2", "eq.3"],
    );
    assert.deepEqual(rows.map((row) => row.transaction_hash), ["tx2", "tx3"]);
    assert.equal(manifest.highestBlock, "3");
    assert.equal(manifest.totalRows, 3);
    assert.deepEqual(
      manifest.files.map((file: any) => file.file),
      [
        "1-10000/1-1000/1-100/1-10/block-1.jsonl",
        "1-10000/1-1000/1-100/1-10/block-2.jsonl",
        "1-10000/1-1000/1-100/1-10/block-3.jsonl",
      ],
    );
  } finally {
    delete process.env.WAS_EVENT_SNAPSHOT_LATEST_BLOCK;
  }
});

test("snapshot-backed client resolves snapshot roots and renames after append", async () => {
  process.env.WAS_EVENT_SNAPSHOT_LATEST_BLOCK = "2";
  const snapshotRoot = mkdtempSync(join(tmpdir(), "was-event-snapshot-root-"));
  const snapshotDir = join(snapshotRoot, "snapshot-1");
  mkdirSync(snapshotDir);
  writeSnapshot(snapshotDir, [
    transfer("10", "1", "tx1"),
  ]);
  const { client } = baseClient([
    transfer("20", "2", "tx2"),
  ]);
  const wrapped = createSnapshotBackedCirrusClient(client, config(snapshotRoot));

  try {
    await wrapped.getRows<any>("/BlockApps-StratoNativeBridge-withdrawals");
    const nextSnapshotDir = join(snapshotRoot, "snapshot-2");
    const manifest = JSON.parse(
      readFileSync(join(nextSnapshotDir, "manifest.json"), "utf8"),
    );

    assert.equal(existsSync(snapshotDir), false);
    assert.equal(
      existsSync(join(nextSnapshotDir, "1-10000/1-1000/1-100/1-10/block-2.jsonl")),
      true,
    );
    assert.equal(manifest.highestBlock, "2");
    assert.equal(manifest.totalRows, 2);
  } finally {
    delete process.env.WAS_EVENT_SNAPSHOT_LATEST_BLOCK;
  }
});

test("snapshot-backed client skips implausible latest snapshot manifests", async () => {
  const snapshotRoot = mkdtempSync(join(tmpdir(), "was-event-snapshot-root-"));
  const validSnapshotDir = join(snapshotRoot, "snapshot-1");
  const invalidSnapshotDir = join(snapshotRoot, "snapshot-2");
  mkdirSync(validSnapshotDir);
  mkdirSync(invalidSnapshotDir);
  writeSnapshot(validSnapshotDir, [
    transfer("10", "1", "tx1"),
  ]);
  writeFileSync(
    join(invalidSnapshotDir, "manifest.json"),
    JSON.stringify(
      {
        totalRows: 10,
        highestBlock: "2",
        files: Array.from({ length: 4 }, (_, index) => ({
          block: String(index),
          file: `missing-${index}.jsonl`,
          rowCount: 1,
        })),
      },
      null,
      2,
    ),
  );
  const { client } = baseClient();
  const wrapped = createSnapshotBackedCirrusClient(client, config(snapshotRoot));

  const rows = await wrapped.getRows<CirrusEventRow>("/event", {
    block_number: "eq.1",
    transaction_hash: "eq.tx1",
  });

  assert.deepEqual(rows.map((row) => row.transaction_hash), ["tx1"]);
});

test("snapshot-backed client stores appended block files in nested range folders", async () => {
  process.env.WAS_EVENT_SNAPSHOT_LATEST_BLOCK = "201";
  const snapshotDir = makeSnapshot([
    transfer("10", "100", "tx100"),
  ]);
  const { client } = baseClient([
    transfer("101", "101", "tx101"),
    transfer("200", "200", "tx200"),
    transfer("201", "201", "tx201"),
  ]);
  const wrapped = createSnapshotBackedCirrusClient(client, config(snapshotDir));

  try {
    await wrapped.getRows<any>("/BlockApps-MercataBridge-withdrawals");
    const manifest = JSON.parse(
      readFileSync(join(snapshotDir, "manifest.json"), "utf8"),
    );

    assert.deepEqual(
      manifest.files.map((file: any) => file.file),
      [
        "1-10000/1-1000/1-100/91-100/block-100.jsonl",
        "1-10000/1-1000/101-200/101-110/block-101.jsonl",
        "1-10000/1-1000/101-200/191-200/block-200.jsonl",
        "1-10000/1-1000/201-300/201-210/block-201.jsonl",
      ],
    );
    assert.equal(
      existsSync(join(snapshotDir, "1-10000/1-1000/101-200/101-110/block-101.jsonl")),
      true,
    );
    assert.equal(
      existsSync(join(snapshotDir, "1-10000/1-1000/201-300/201-210/block-201.jsonl")),
      true,
    );
  } finally {
    delete process.env.WAS_EVENT_SNAPSHOT_LATEST_BLOCK;
  }
});

