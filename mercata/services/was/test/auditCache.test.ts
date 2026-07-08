/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAuditCacheKey,
  createWithdrawalAuditCache,
} from "../src/auditCache";
import { AuditCacheKeyParts } from "../src/types";
import { WithdrawalAuditTrace } from "@mercata/shared-types";

const keyParts = (
  overrides: Partial<AuditCacheKeyParts> = {},
): AuditCacheKeyParts => ({
  routeType: "standard",
  withdrawalId: "1",
  bridgeStatus: "2",
  timestamp: "100",
  maxDepth: 5,
  ...overrides,
});

const trace = (
  bridgeStatus: string,
  updatedAt: string,
): WithdrawalAuditTrace => ({
  status: "complete",
  decision: "MANUAL_REVIEW",
  riskLevel: "medium",
  withdrawal: {
    routeType: "standard",
    withdrawalId: "1",
    bridgeStatus,
    stratoSender: "3333333333333333333333333333333333333333",
    stratoToken: "4444444444444444444444444444444444444444",
    stratoTokenAmount: "100",
    externalChainId: "1",
    externalRecipient: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  },
  coverage: {
    clean: "0",
    tainted: "0",
    unknown: "100",
  },
  summary: [],
  traceTree: {
    id: "root",
    type: "withdrawal",
    label: "WithdrawalRequested",
    result: "unknown",
    explanation: "",
    evidence: {},
    children: [],
  },
  updatedAt,
});

test("buildAuditCacheKey uses route id status timestamp and maxDepth", () => {
  assert.equal(
    buildAuditCacheKey(keyParts()),
    "standard:1:2:100:maxDepth=5",
  );
  assert.equal(
    buildAuditCacheKey(keyParts({ maxDepth: undefined })),
    "standard:1:2:100:maxDepth=none",
  );
});

test("cache lists recent audits by explicit status group and maxDepth", () => {
  const cache = createWithdrawalAuditCache();

  cache.set(keyParts({ bridgeStatus: "1", withdrawalId: "1" }), trace("1", "2026-01-01T00:00:00.000Z"));
  cache.set(keyParts({ bridgeStatus: "2", withdrawalId: "2" }), trace("2", "2026-01-01T00:01:00.000Z"));
  cache.set(keyParts({ bridgeStatus: "3", withdrawalId: "3" }), trace("3", "2026-01-01T00:02:00.000Z"));
  cache.set(keyParts({ bridgeStatus: "4", withdrawalId: "4" }), trace("4", "2026-01-01T00:03:00.000Z"));
  cache.set(
    keyParts({ bridgeStatus: "2", withdrawalId: "5", maxDepth: undefined }),
    trace("2", "2026-01-01T00:04:00.000Z"),
  );

  assert.equal(cache.listRecent("initiated", 10, 5).length, 1);
  assert.equal(cache.listRecent("pending-review", 10, 5).length, 1);
  assert.equal(cache.listRecent("complete", 10, 5).length, 1);
  assert.equal(cache.listRecent("aborted", 10, 5).length, 1);
  assert.equal(cache.listRecent("pending-review", 10, undefined).length, 1);
});

test("cache detail lookup returns newest matching route id and maxDepth", () => {
  const cache = createWithdrawalAuditCache();

  cache.set(keyParts({ timestamp: "100" }), trace("2", "2026-01-01T00:00:00.000Z"));
  cache.set(keyParts({ timestamp: "101" }), trace("2", "2026-01-01T00:01:00.000Z"));
  cache.set(keyParts({ timestamp: "102", maxDepth: undefined }), trace("2", "2026-01-01T00:02:00.000Z"));

  assert.equal(cache.getLatest("standard", "1", 5)?.keyParts.timestamp, "101");
  assert.equal(
    cache.getLatest("standard", "1", undefined)?.keyParts.timestamp,
    "102",
  );
  assert.equal(cache.getLatest("native", "1", 5), undefined);
});

