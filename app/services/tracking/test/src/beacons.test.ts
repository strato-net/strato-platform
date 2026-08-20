import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { api, cirrusAddress, createLink, db, openLink, randomAddress, sql, waitForReady } from "./helpers";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("anonymous beacons", () => {
  before(() => waitForReady());
  after(() => db.end());

  it("POST /tracking-api/engage marks the session engaged and answers 204 either way", async () => {
    const link = await createLink();
    const { cookie, sessionId } = await openLink(link.slug);
    await sleep(200);

    const res = await api("/tracking-api/engage", { method: "POST", cookie });
    assert.equal(res.status, 204);
    const { rows } = await sql("SELECT engaged_at FROM tracking_sessions WHERE id = $1", [sessionId]);
    assert.ok(rows[0].engaged_at, "engaged_at not set");

    // Idempotent: the first engagement timestamp is kept
    const first = rows[0].engaged_at;
    await api("/tracking-api/engage", { method: "POST", cookie });
    const again = await sql("SELECT engaged_at FROM tracking_sessions WHERE id = $1", [sessionId]);
    assert.equal(String(again.rows[0].engaged_at), String(first));

    // No cookie / unknown cookie: still 204, nothing leaks
    assert.equal((await api("/tracking-api/engage", { method: "POST" })).status, 204);
    assert.equal(
      (await api("/tracking-api/engage", { method: "POST", cookie: "strato_tid=00000000-0000-0000-0000-000000000000" })).status,
      204
    );
    assert.equal((await api("/tracking-api/engage", { method: "POST", cookie: "strato_tid=garbage" })).status, 204);
  });

  it("POST /tracking-api/wallet-connected stores normalized addresses once per session", async () => {
    const link = await createLink();
    const { cookie, sessionId } = await openLink(link.slug);
    await sleep(200);
    const external = randomAddress().toUpperCase().replace("0X", "0x");
    const strato = randomAddress();

    const first = await api("/tracking-api/wallet-connected", {
      method: "POST",
      cookie,
      body: { externalWalletAddress: external, stratoAddress: strato, connector: "MetaMask" },
    });
    assert.equal(first.status, 204);
    const dup = await api("/tracking-api/wallet-connected", {
      method: "POST",
      cookie,
      body: { externalWalletAddress: external, stratoAddress: strato, connector: "MetaMask" },
    });
    assert.equal(dup.status, 204);

    const { rows } = await sql("SELECT * FROM wallet_connections WHERE session_id = $1", [sessionId]);
    assert.equal(rows.length, 1, "duplicate connection should be deduped");
    assert.equal(rows[0].external_wallet_address, cirrusAddress(external));
    assert.equal(rows[0].strato_address, cirrusAddress(strato));
    assert.equal(rows[0].connector, "MetaMask");
    assert.equal(String(rows[0].link_id), link.id);
  });

  it("ignores invalid addresses and sessions without a cookie", async () => {
    const link = await createLink();
    const { cookie, sessionId } = await openLink(link.slug);
    await sleep(200);
    assert.equal(
      (await api("/tracking-api/wallet-connected", { method: "POST", cookie, body: { stratoAddress: "0x1234" } })).status,
      204
    );
    assert.equal(
      (await api("/tracking-api/wallet-connected", { method: "POST", cookie, body: {} })).status,
      204
    );
    assert.equal(
      (await api("/tracking-api/wallet-connected", { method: "POST", body: { stratoAddress: randomAddress() } })).status,
      204
    );
    const { rows } = await sql("SELECT * FROM wallet_connections WHERE session_id = $1", [sessionId]);
    assert.equal(rows.length, 0);
  });

  it("a session can accumulate distinct wallets (external-only, then external+strato)", async () => {
    const link = await createLink();
    const { cookie, sessionId } = await openLink(link.slug);
    await sleep(200);
    const external = randomAddress();
    await api("/tracking-api/wallet-connected", { method: "POST", cookie, body: { externalWalletAddress: external } });
    await api("/tracking-api/wallet-connected", {
      method: "POST",
      cookie,
      body: { externalWalletAddress: external, stratoAddress: randomAddress() },
    });
    const { rows } = await sql("SELECT * FROM wallet_connections WHERE session_id = $1 ORDER BY id", [sessionId]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].strato_address, "");
    assert.notEqual(rows[1].strato_address, "");
  });
});
