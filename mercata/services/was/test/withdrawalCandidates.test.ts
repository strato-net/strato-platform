/// <reference types="node" />

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import dotenv from "dotenv";
import { WithdrawalAuditStatusGroup } from "@mercata/shared-types";
import { createAccessTokenProvider } from "../src/auth";
import { createCirrusClient } from "../src/cirrusClient";
import { loadConfig } from "../src/config";
import { createWithdrawalRepository } from "../src/withdrawalRepository";
import { CirrusClient, CirrusQueryParams, WasConfig } from "../src/types";

const wasRoot = resolve(__dirname, "..");
dotenv.config({ path: join(wasRoot, ".env") });
dotenv.config({ path: resolve(wasRoot, "../../backend/.env") });

const snapshotDir = join(wasRoot, "test/fixtures/schema-snapshot/current");

const readJson = <T = any>(path: string): T =>
  JSON.parse(readFileSync(path, "utf8"));

const standardSnapshot = readJson(
  join(snapshotDir, "mercataBridge-withdrawals.json"),
);
const nativeSnapshot = readJson(
  join(snapshotDir, "stratoNativeBridge-withdrawals.json"),
);

const config: WasConfig = {
  nodeUrl: "https://example.invalid",
  mercataBridge: "0000000000000000000000000000000000001008",
  stratoNativeBridge: "4d9e9c39180a75091b9c35bbb9064d67c7fdde5a",
  port: 3002,
  pollIntervalMs: 30_000,
  includeTerminalWithdrawals: true,
};

const statusMatches = (status: string, filter?: string | number | boolean) => {
  if (!filter) return true;
  if (filter === "eq.1") return status === "1";
  if (filter === "eq.2") return status === "2";
  if (filter === "eq.3") return status === "3";
  if (filter === "eq.4") return status === "4";
  return false;
};

const createMockCirrusClient = () => {
  const requests: { table: string; params?: CirrusQueryParams }[] = [];
  const rowsByTable: Record<string, any[]> = {
    "/BlockApps-MercataBridge-withdrawals": standardSnapshot.sampleRows,
    "/BlockApps-StratoNativeBridge-withdrawals": nativeSnapshot.sampleRows,
  };

  const client: CirrusClient = {
    getRows: async <T>(table: string, params?: CirrusQueryParams) => {
      requests.push({ table, params });
      const rows = rowsByTable[table] || [];
      const filtered = rows.filter((row) =>
        statusMatches(row.value.bridgeStatus, params?.["value->>bridgeStatus"]),
      );
      return filtered.slice(0, Number(params?.limit || filtered.length)) as T[];
    },
    verifyConnectivity: async () => undefined,
  };

  return { client, requests };
};

const assertCandidateShape = (candidate: any, routeType: "standard" | "native") => {
  assert.equal(candidate.routeType, routeType);
  for (const field of [
    "withdrawalId",
    "bridgeStatus",
    "stratoSender",
    "stratoToken",
    "stratoTokenAmount",
    "externalChainId",
    "externalRecipient",
  ]) {
    assert.equal(
      typeof candidate[field],
      "string",
      `${routeType} candidate ${field} must be a string`,
    );
    assert.notEqual(candidate[field], "", `${routeType} candidate ${field} must not be empty`);
  }
};

test("fetchWithdrawalCandidates normalizes standard and native rows", async () => {
  const { client } = createMockCirrusClient();
  const repository = createWithdrawalRepository(client, config);

  const candidates = await repository.fetchWithdrawalCandidates("complete", 10);
  assert.ok(candidates.length > 0, "expected candidates from generated snapshots");

  const standard = candidates.find((candidate) => candidate.routeType === "standard");
  const native = candidates.find((candidate) => candidate.routeType === "native");
  assert.ok(standard, "expected a standard withdrawal candidate");
  assert.ok(native, "expected a native withdrawal candidate");

  assertCandidateShape(standard, "standard");
  assertCandidateShape(native, "native");
});

test("fetchWithdrawalCandidates applies status-group filters and limit", async () => {
  for (const statusGroup of ["initiated", "pending-review", "complete", "aborted"] as WithdrawalAuditStatusGroup[]) {
    const { client, requests } = createMockCirrusClient();
    const repository = createWithdrawalRepository(client, config);
    const limit = 3;

    const candidates = await repository.fetchWithdrawalCandidates(statusGroup, limit);

    assert.ok(candidates.length <= limit, `${statusGroup} exceeded requested limit`);
    assert.equal(requests.length, 2, `${statusGroup} should query both bridge routes`);

    const expectedFilter =
      statusGroup === "initiated"
        ? "eq.1"
        : statusGroup === "pending-review"
          ? "eq.2"
          : statusGroup === "complete"
        ? "eq.3"
        : statusGroup === "aborted"
          ? "eq.4"
          : "eq.1";
    for (const request of requests) {
      assert.equal(request.params?.["value->>bridgeStatus"], expectedFilter);
      assert.equal(request.params?.select, "key,value,block_timestamp");
      assert.equal(request.params?.limit, limit);
    }
  }
});

test("live fetchWithdrawalCandidates returns bounded normalized candidates", async (t) => {
  if (process.env.WAS_RUN_LIVE_TESTS !== "true") {
    t.skip("set WAS_RUN_LIVE_TESTS=true to run live Cirrus candidate fetches");
    return;
  }

  const liveConfig = loadConfig();
  const repository = createWithdrawalRepository(
    createCirrusClient(liveConfig, createAccessTokenProvider(liveConfig)),
    liveConfig,
  );

  for (const statusGroup of ["initiated", "pending-review", "complete", "aborted"] as WithdrawalAuditStatusGroup[]) {
    const candidates = await repository.fetchWithdrawalCandidates(statusGroup, 2);
    assert.ok(candidates.length <= 2, `${statusGroup} exceeded live fetch limit`);
    for (const candidate of candidates) {
      assertCandidateShape(candidate, candidate.routeType);
    }
  }
});
