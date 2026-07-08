/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import { createWithdrawalAuditCache } from "../src/auditCache";
import { createWithdrawalAuditService } from "../src/auditService";
import {
  ProvenanceEngine,
  WasConfig,
  WithdrawalCandidateRepository,
} from "../src/types";
import {
  NormalizedWithdrawalAudit,
  WithdrawalAuditStatusGroup,
  WithdrawalAuditTrace,
} from "@mercata/shared-types";

const config = (includeTerminalWithdrawals = true): WasConfig => ({
  nodeUrl: "https://example.invalid",
  mercataBridge: "0000000000000000000000000000000000001008",
  stratoNativeBridge: "4d9e9c39180a75091b9c35bbb9064d67c7fdde5a",
  port: 3002,
  pollIntervalMs: 30_000,
  traceMaxDepth: 5,
  includeTerminalWithdrawals,
});

const withdrawal = (
  bridgeStatus: string,
  withdrawalId = bridgeStatus,
): NormalizedWithdrawalAudit => ({
  routeType: "standard",
  withdrawalId,
  bridgeStatus,
  stratoSender: "3333333333333333333333333333333333333333",
  stratoToken: "4444444444444444444444444444444444444444",
  stratoTokenAmount: "100",
  externalChainId: "1",
  externalRecipient: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  timestamp: `10${bridgeStatus}`,
});

const traceFor = (
  candidate: NormalizedWithdrawalAudit,
): WithdrawalAuditTrace => ({
  status: "complete",
  decision: "MANUAL_REVIEW",
  riskLevel: "medium",
  withdrawal: candidate,
  maxDepth: 5,
  coverage: { clean: "0", tainted: "0", unknown: candidate.stratoTokenAmount },
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
  updatedAt: new Date(Number(candidate.bridgeStatus) * 1000).toISOString(),
});

const statusToBridgeStatus: Record<WithdrawalAuditStatusGroup, string> = {
  initiated: "1",
  "pending-review": "2",
  complete: "3",
  aborted: "4",
};

const createMocks = () => {
  const fetchCalls: WithdrawalAuditStatusGroup[] = [];
  const traceCalls: NormalizedWithdrawalAudit[] = [];

  const repository: WithdrawalCandidateRepository = {
    fetchWithdrawalCandidates: async (statusGroup) => {
      fetchCalls.push(statusGroup);
      return [withdrawal(statusToBridgeStatus[statusGroup])];
    },
    fetchCanonicalWithdrawalEvent: async () => null,
    fetchFundingLots: async () => [],
    fetchTrustAnchor: async () => null,
  };

  const provenanceEngine: ProvenanceEngine = {
    traceWithdrawal: async ({ withdrawal }) => {
      traceCalls.push(withdrawal);
      return traceFor(withdrawal);
    },
    classifyCoverage: () => ({ clean: "0", tainted: "0", unknown: "0" }),
    resolveTraceEdge: async (lot) => ({
      type: "unsupported",
      to: lot,
      result: "unknown",
      explanation: "",
    }),
  };

  return { repository, provenanceEngine, fetchCalls, traceCalls };
};

test("warmAuditCache creates readable recent and detail cache entries", async () => {
  const cache = createWithdrawalAuditCache();
  const { repository, provenanceEngine } = createMocks();
  const service = createWithdrawalAuditService(
    config(),
    cache,
    repository,
    provenanceEngine,
  );

  const result = await service.warmAuditCache({
    limit: 10,
    maxDepth: 5,
    statusGroups: ["pending-review"],
  });

  assert.equal(result.started, true);
  assert.equal(result.completed, true);
  assert.equal(result.groups["pending-review"], 1);

  const recent = await service.getRecentAudits(10, 5, "pending-review");
  assert.equal(recent.data.length, 1);
  assert.equal(recent.data[0].withdrawal.bridgeStatus, "2");

  const detail = await service.getAudit("standard", "2", 5);
  assert.equal(detail?.withdrawal.bridgeStatus, "2");
});

test("read methods are cache-only and do not call repository or tracer", async () => {
  const cache = createWithdrawalAuditCache();
  const { repository, provenanceEngine, fetchCalls, traceCalls } = createMocks();
  const service = createWithdrawalAuditService(
    config(),
    cache,
    repository,
    provenanceEngine,
  );

  await service.getRecentAudits(10, 5, "initiated");
  await service.getAudit("standard", "1", 5);

  assert.deepEqual(fetchCalls, []);
  assert.deepEqual(traceCalls, []);
});

test("warmAuditCache warms all status groups when terminal withdrawals are included", async () => {
  const cache = createWithdrawalAuditCache();
  const { repository, provenanceEngine, fetchCalls } = createMocks();
  const service = createWithdrawalAuditService(
    config(true),
    cache,
    repository,
    provenanceEngine,
  );

  const result = await service.warmAuditCache({ limit: 10, maxDepth: 5 });

  assert.deepEqual(fetchCalls, [
    "initiated",
    "pending-review",
    "complete",
    "aborted",
  ]);
  assert.deepEqual(result.groups, {
    initiated: 1,
    "pending-review": 1,
    complete: 1,
    aborted: 1,
  });
});

test("warmAuditCache warms only active statuses when terminal withdrawals are excluded", async () => {
  const cache = createWithdrawalAuditCache();
  const { repository, provenanceEngine, fetchCalls } = createMocks();
  const service = createWithdrawalAuditService(
    config(false),
    cache,
    repository,
    provenanceEngine,
  );

  await service.warmAuditCache({ limit: 10, maxDepth: 5 });

  assert.deepEqual(fetchCalls, ["initiated", "pending-review"]);
});

test("warmAuditCache is non-overlapping", async () => {
  let releaseFetch!: () => void;
  const blockingFetch = new Promise<void>((resolve) => {
    releaseFetch = resolve;
  });
  const repository: WithdrawalCandidateRepository = {
    fetchWithdrawalCandidates: async () => {
      await blockingFetch;
      return [withdrawal("1")];
    },
    fetchCanonicalWithdrawalEvent: async () => null,
    fetchFundingLots: async () => [],
    fetchTrustAnchor: async () => null,
  };
  const provenanceEngine = createMocks().provenanceEngine;
  const service = createWithdrawalAuditService(
    config(),
    createWithdrawalAuditCache(),
    repository,
    provenanceEngine,
  );

  const firstWarm = service.warmAuditCache({
    limit: 10,
    maxDepth: 5,
    statusGroups: ["initiated"],
  });
  const secondWarm = await service.warmAuditCache({
    limit: 10,
    maxDepth: 5,
    statusGroups: ["initiated"],
  });
  releaseFetch();
  const firstResult = await firstWarm;

  assert.equal(secondWarm.started, false);
  assert.equal(secondWarm.completed, false);
  assert.equal(secondWarm.skippedReason, "warming already running");
  assert.equal(firstResult.started, true);
});

