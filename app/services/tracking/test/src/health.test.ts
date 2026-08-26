import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { api, db, sql, waitForReady } from "./helpers";

describe("service bootstrap", () => {
  before(() => waitForReady());
  after(() => db.end());

  it("GET /health answers pong", async () => {
    const res = await api("/health");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: true, message: "pong" });
  });

  it("applies every embedded migration exactly once", async () => {
    const { rows } = await sql<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name");
    const names = rows.map((r) => r.name);
    assert.ok(names.includes("001_init"), `001_init missing from ${names}`);
    assert.ok(names.includes("002_session_geo"), `002_session_geo missing from ${names}`);
    assert.ok(names.includes("003_source_split"), `003_source_split missing from ${names}`);
    assert.ok(names.includes("004_metrics_indexes"), `004_metrics_indexes missing from ${names}`);
    assert.ok(names.includes("005_session_diagnostics"), `005_session_diagnostics missing from ${names}`);
    assert.equal(new Set(names).size, names.length, "duplicate migration rows");
  });

  it("creates the service tables", async () => {
    const { rows } = await sql<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );
    const tables = rows.map((r) => r.table_name);
    for (const expected of [
      "tracking_links",
      "tracking_sessions",
      "wallet_connections",
      "posthog_wallet_connections",
    ]) {
      assert.ok(tables.includes(expected), `${expected} missing from ${tables}`);
    }
    const cols = (await sql<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'tracking_links'")).rows.map((r) => r.column_name);
    assert.ok(cols.includes("full_source"), `full_source column missing (migration 003): ${cols}`);

    const indexes = (await sql<{ indexname: string }>("SELECT indexname FROM pg_indexes WHERE tablename = 'tracking_sessions'")).rows.map((r) => r.indexname);
    assert.ok(indexes.includes("tracking_sessions_opened_at_idx"), `opened_at index missing (migration 004): ${indexes}`);
    assert.ok(indexes.includes("tracking_sessions_ip_opened_idx"), `ip/opened_at index missing (migration 005): ${indexes}`);

    // Migration 005 diagnostics columns
    const sessionCols = (await sql<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'tracking_sessions'")).rows.map((r) => r.column_name);
    assert.ok(sessionCols.includes("bot_reason"), `bot_reason column missing (migration 005): ${sessionCols}`);
    const connectionCols = (await sql<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'wallet_connections'")).rows.map((r) => r.column_name);
    assert.ok(connectionCols.includes("session_source"), `session_source column missing (migration 005): ${connectionCols}`);
    const posthogConnectionCols = (
      await sql<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'posthog_wallet_connections'"
      )
    ).rows.map((r) => r.column_name);
    for (const expected of [
      "posthog_session_id",
      "posthog_distinct_id",
      "external_wallet_address",
      "strato_address",
      "connected_at",
    ]) {
      assert.ok(posthogConnectionCols.includes(expected), `${expected} missing from ${posthogConnectionCols}`);
    }
  });
});
