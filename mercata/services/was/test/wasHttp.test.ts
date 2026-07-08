/// <reference types="node" />

import assert from "node:assert/strict";
import { Server } from "node:http";
import test from "node:test";
import { createWasApp } from "../src/http";
import {
  WarmAuditCacheRequest,
  WithdrawalAuditService,
} from "../src/types";
import { WithdrawalAuditTrace } from "@mercata/shared-types";

const trace = (): WithdrawalAuditTrace => ({
  status: "complete",
  decision: "MANUAL_REVIEW",
  riskLevel: "medium",
  withdrawal: {
    routeType: "standard",
    withdrawalId: "1",
    bridgeStatus: "2",
    stratoSender: "3333333333333333333333333333333333333333",
    stratoToken: "4444444444444444444444444444444444444444",
    stratoTokenAmount: "100",
    externalChainId: "1",
    externalRecipient: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  },
  maxDepth: 5,
  coverage: { clean: "0", tainted: "0", unknown: "100" },
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
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const withServer = async (
  service: WithdrawalAuditService,
  run: (baseUrl: string) => Promise<void>,
) => {
  const app = createWasApp(service);
  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
};

const createMockService = () => {
  const calls: {
    recent: any[];
    detail: any[];
    warm: WarmAuditCacheRequest[];
  } = {
    recent: [],
    detail: [],
    warm: [],
  };

  const service: WithdrawalAuditService = {
    getRecentAudits: async (...args) => {
      calls.recent.push(args);
      return { data: [{ withdrawal: trace().withdrawal, audit: trace() }] };
    },
    getAudit: async (...args) => {
      calls.detail.push(args);
      return trace();
    },
    warmAuditCache: async (request = {}) => {
      calls.warm.push(request);
      return {
        started: true,
        completed: true,
        groups: { initiated: 1, "pending-review": 0, complete: 0, aborted: 0 },
      };
    },
  };

  return { service, calls };
};

test("GET /health returns WAS health payload", async () => {
  const { service } = createMockService();

  await withServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "ok",
      service: "withdrawal-auditing-service",
    });
  });
});

test("GET /audits/withdrawals/recent forwards parsed query params", async () => {
  const { service, calls } = createMockService();

  await withServer(service, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/audits/withdrawals/recent?limit=99&maxDepth=5&statusGroup=pending-review`,
    );
    assert.equal(response.status, 200);
    const body: any = await response.json();
    assert.equal(body.data.length, 1);
  });

  assert.deepEqual(calls.recent[0], [10, 5, "pending-review"]);
});

test("GET /audits/withdrawals/recent defaults invalid params", async () => {
  const { service, calls } = createMockService();

  await withServer(service, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/audits/withdrawals/recent?limit=-1&maxDepth=bad&statusGroup=bad`,
    );
    assert.equal(response.status, 200);
  });

  assert.deepEqual(calls.recent[0], [10, undefined, "initiated"]);
});

test("GET /audits/withdrawals/:routeType/:withdrawalId returns detail", async () => {
  const { service, calls } = createMockService();

  await withServer(service, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/audits/withdrawals/standard/1?maxDepth=5`,
    );
    assert.equal(response.status, 200);
    const body: any = await response.json();
    assert.equal(body.withdrawal.withdrawalId, "1");
  });

  assert.deepEqual(calls.detail[0], ["standard", "1", 5]);
});

test("GET /audits/withdrawals/:routeType/:withdrawalId returns 404 on cache miss", async () => {
  const { service } = createMockService();
  service.getAudit = async () => null;

  await withServer(service, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/audits/withdrawals/standard/404?maxDepth=5`,
    );
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Audit not ready" });
  });
});

test("POST /audits/withdrawals/warm starts manual warm", async () => {
  const { service, calls } = createMockService();

  await withServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/audits/withdrawals/warm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 99, maxDepth: 5 }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { started: true });
  });

  assert.deepEqual(calls.warm[0], { limit: 10, maxDepth: 5 });
});

