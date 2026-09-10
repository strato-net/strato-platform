import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  BROWSER_UA,
  api,
  cirrusAddress,
  createLink,
  db,
  openLink,
  randomAddress,
  sql,
  testIp,
  waitForReady,
} from "./helpers";

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

  it("stores a PostHog session-to-wallet join without a tracking-link session", async () => {
    const external = randomAddress();
    const posthogSessionId = "019c0000-0000-7000-8000-000000000001";
    const body = {
      externalWalletAddress: external,
      connector: "MetaMask",
      posthogSessionId,
      posthogDistinctId: "anonymous-browser-1",
    };

    assert.equal(
      (await api("/tracking-api/wallet-connected", { method: "POST", body })).status,
      204
    );
    assert.equal(
      (await api("/tracking-api/wallet-connected", { method: "POST", body })).status,
      204
    );

    const { rows } = await sql(
      "SELECT * FROM posthog_wallet_connections WHERE posthog_session_id = $1",
      [posthogSessionId]
    );
    assert.equal(rows.length, 1, "duplicate PostHog connection should be deduped");
    assert.equal(rows[0].external_wallet_address, cirrusAddress(external));
    assert.equal(rows[0].strato_address, "");
    assert.equal(rows[0].connector, "MetaMask");
    assert.equal(rows[0].posthog_distinct_id, "anonymous-browser-1");
  });

  it("does not store malformed PostHog session identifiers", async () => {
    const external = randomAddress();
    assert.equal(
      (
        await api("/tracking-api/wallet-connected", {
          method: "POST",
          body: {
            externalWalletAddress: external,
            posthogSessionId: "not-a-session",
            posthogDistinctId: "anonymous-browser-2",
          },
        })
      ).status,
      204
    );
    const { rows } = await sql(
      "SELECT 1 FROM posthog_wallet_connections WHERE external_wallet_address = $1",
      [cirrusAddress(external)]
    );
    assert.equal(rows.length, 0);
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

  it("accepts the session id from ?stid= and X-Strato-Tid when the cookie is lost", async () => {
    const link = await createLink();
    const { sessionId } = await openLink(link.slug);
    await sleep(200);

    // Cross-host landing: the app echoes the stid the resolver put in the URL
    const queryExternal = randomAddress();
    assert.equal(
      (await api(`/tracking-api/engage?stid=${sessionId}`, { method: "POST" })).status,
      204
    );
    assert.equal(
      (
        await api(`/tracking-api/wallet-connected?stid=${sessionId}`, {
          method: "POST",
          body: { externalWalletAddress: queryExternal },
        })
      ).status,
      204
    );

    const headerExternal = randomAddress();
    assert.equal(
      (
        await api("/tracking-api/wallet-connected", {
          method: "POST",
          headers: { "X-Strato-Tid": sessionId! },
          body: { externalWalletAddress: headerExternal },
        })
      ).status,
      204
    );

    const engaged = await sql("SELECT engaged_at FROM tracking_sessions WHERE id = $1", [sessionId]);
    assert.ok(engaged.rows[0].engaged_at, "engage via ?stid= did not mark the session");

    const { rows } = await sql(
      "SELECT external_wallet_address, session_source FROM wallet_connections WHERE session_id = $1 ORDER BY id",
      [sessionId]
    );
    assert.deepEqual(
      rows.map((row: any) => [row.external_wallet_address, row.session_source]),
      [
        [cirrusAddress(queryExternal), "query"],
        [cirrusAddress(headerExternal), "header"],
      ]
    );

    // A garbage stid is ignored (and never 500s)
    assert.equal(
      (
        await api("/tracking-api/wallet-connected?stid=nope", {
          method: "POST",
          body: { externalWalletAddress: randomAddress() },
        })
      ).status,
      204
    );
  });

  it("binds a cookieless wallet-connected beacon to a recent open from the same IP", async () => {
    const link = await createLink();
    const ip = testIp();
    const { sessionId } = await openLink(link.slug, BROWSER_UA, { "X-Forwarded-For": ip });
    await sleep(300);

    const external = randomAddress();
    const res = await api("/tracking-api/wallet-connected", {
      method: "POST",
      headers: { "X-Forwarded-For": ip },
      body: { externalWalletAddress: external, connector: "MetaMask" },
    });
    assert.equal(res.status, 204);

    const { rows } = await sql(
      "SELECT session_id, link_id, session_source FROM wallet_connections WHERE external_wallet_address = $1",
      [cirrusAddress(external)]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].session_id, sessionId);
    assert.equal(String(rows[0].link_id), link.id);
    assert.equal(rows[0].session_source, "ip");

    // Another IP with no open of its own attributes nothing
    const stranger = randomAddress();
    await api("/tracking-api/wallet-connected", {
      method: "POST",
      headers: { "X-Forwarded-For": testIp() },
      body: { externalWalletAddress: stranger },
    });
    const none = await sql("SELECT 1 FROM wallet_connections WHERE external_wallet_address = $1", [
      cirrusAddress(stranger),
    ]);
    assert.equal(none.rows.length, 0);
  });

  it("drops the same-IP fallback when that IP opened more than one link", async () => {
    const first = await createLink();
    const second = await createLink();
    const ip = testIp();
    await openLink(first.slug, BROWSER_UA, { "X-Forwarded-For": ip });
    await openLink(second.slug, BROWSER_UA, { "X-Forwarded-For": ip });
    await sleep(300);

    const external = randomAddress();
    const res = await api("/tracking-api/wallet-connected", {
      method: "POST",
      headers: { "X-Forwarded-For": ip },
      body: { externalWalletAddress: external },
    });
    assert.equal(res.status, 204);
    const { rows } = await sql("SELECT 1 FROM wallet_connections WHERE external_wallet_address = $1", [
      cirrusAddress(external),
    ]);
    assert.equal(rows.length, 0, "an ambiguous IP must not be guessed");
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
