/// <reference types="node" />

import assert from "node:assert/strict";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import test from "node:test";

type RequestRecord = {
  method?: string;
  url?: string;
};

const startMockWas = async (
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ baseUrl: string; server: Server; requests: RequestRecord[] }> => {
  const requests: RequestRecord[] = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    server,
    requests,
  };
};

const closeServer = async (server: Server) => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
};

const importBackendProxy = async (wasUrl: string) => {
  process.env.OAUTH_DISCOVERY_URL ||= "https://example.invalid/.well-known/openid-configuration";
  process.env.OAUTH_CLIENT_ID ||= "test-client";
  process.env.OAUTH_CLIENT_SECRET ||= "test-secret";
  process.env.NODE_URL ||= "https://example.invalid";
  process.env.WAS_URL = wasUrl;

  const configPath = require.resolve("../../../backend/src/config/config");
  const servicePath = require.resolve(
    "../../../backend/src/api/services/withdrawalAudit.service",
  );
  delete require.cache[configPath];
  delete require.cache[servicePath];
  return require(servicePath);
};

test("backend proxy forwards recent audit params to WAS", async () => {
  const mock = await startMockWas((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: [] }));
  });

  try {
    const { getRecentWithdrawalAudits } = await importBackendProxy(mock.baseUrl);
    const result = await getRecentWithdrawalAudits(7, 5, "pending-review");

    assert.deepEqual(result, { data: [] });
    assert.equal(mock.requests[0].method, "GET");
    assert.ok(
      mock.requests[0].url?.startsWith("/audits/withdrawals/recent?"),
      `unexpected URL ${mock.requests[0].url}`,
    );
    const url = new URL(`${mock.baseUrl}${mock.requests[0].url}`);
    assert.equal(url.searchParams.get("limit"), "7");
    assert.equal(url.searchParams.get("maxDepth"), "5");
    assert.equal(url.searchParams.get("statusGroup"), "pending-review");
  } finally {
    await closeServer(mock.server);
  }
});

test("backend proxy forwards detail params to WAS", async () => {
  const mock = await startMockWas((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        status: "complete",
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
      }),
    );
  });

  try {
    const { getWithdrawalAudit } = await importBackendProxy(mock.baseUrl);
    const result = await getWithdrawalAudit("standard", "1", 5);

    assert.equal(result?.withdrawal.withdrawalId, "1");
    assert.equal(mock.requests[0].method, "GET");
    assert.ok(
      mock.requests[0].url?.startsWith("/audits/withdrawals/standard/1?"),
      `unexpected URL ${mock.requests[0].url}`,
    );
    const url = new URL(`${mock.baseUrl}${mock.requests[0].url}`);
    assert.equal(url.searchParams.get("maxDepth"), "5");
  } finally {
    await closeServer(mock.server);
  }
});

test("backend proxy maps WAS detail 404 to null", async () => {
  const mock = await startMockWas((_req, res) => {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Audit not ready" }));
  });

  try {
    const { getWithdrawalAudit } = await importBackendProxy(mock.baseUrl);
    assert.equal(await getWithdrawalAudit("standard", "404", 5), null);
  } finally {
    await closeServer(mock.server);
  }
});

test("backend proxy surfaces WAS unavailable errors", async () => {
  const mock = await startMockWas((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: [] }));
  });
  const { getRecentWithdrawalAudits } = await importBackendProxy(mock.baseUrl);
  await closeServer(mock.server);

  await assert.rejects(() => getRecentWithdrawalAudits(10, 5, "initiated"));
});

