import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { authed, createLink, db, sql, waitForReady, AUTHORIZED_USER, DEFAULT_DESTINATION } from "./helpers";

describe("link management API", () => {
  before(() => waitForReady());
  after(() => db.end());

  it("creates a link with a random 8-char base62 slug and a relative public URL", async () => {
    const link = await createLink({ label: "LinkedIn campaign", source: "LinkedIn", fullSource: "Q3 founders post", destination: "/dashboard/swap" });
    assert.match(link.slug, /^[A-Za-z0-9]{8}$/);
    assert.equal(link.url, `/t/${link.slug}`);
    assert.match(link.id, /^\d+$/);

    const { rows } = await sql("SELECT * FROM tracking_links WHERE id = $1", [link.id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].label, "LinkedIn campaign");
    assert.equal(rows[0].source, "LinkedIn");
    assert.equal(rows[0].full_source, "Q3 founders post");
    assert.equal(rows[0].destination, "/dashboard/swap");
    assert.equal(rows[0].created_by, AUTHORIZED_USER);
    assert.equal(rows[0].active, true);
  });

  it("defaults the destination and rejects invalid input", async () => {
    const link = await createLink({ label: "Defaults" });
    const { rows } = await sql("SELECT destination FROM tracking_links WHERE id = $1", [link.id]);
    assert.equal(rows[0].destination, DEFAULT_DESTINATION);

    assert.equal((await authed("/tracking-api/links", { body: {} })).status, 400);
    assert.equal((await authed("/tracking-api/links", { body: { label: "   " } })).status, 400);
    assert.equal((await authed("/tracking-api/links", { body: { label: "x".repeat(201) } })).status, 400);
    assert.equal((await authed("/tracking-api/links", { body: { label: "x", fullSource: "y".repeat(201) } })).status, 400);
  });

  it("accepts relative paths and absolute http(s) destinations, rejects header-injection shapes", async () => {
    const external = await createLink({ label: "External", destination: "https://docs.strato.nexus/start?ref=li" });
    const { rows } = await sql("SELECT destination FROM tracking_links WHERE id = $1", [external.id]);
    assert.equal(rows[0].destination, "https://docs.strato.nexus/start?ref=li");
    for (const bad of ["//evil.example/x", "javascript:alert(1)", "ftp://x.example/y", "/dash board", "/x\r\nSet-Cookie: a=b", "x".repeat(2049)]) {
      const res = await authed("/tracking-api/links", { body: { label: "evil", destination: bad } });
      assert.equal(res.status, 400, `destination ${JSON.stringify(bad)} should be rejected`);
    }
  });

  it("lists links newest first with zeroed metrics", async () => {
    const link = await createLink({ label: "Listed" });
    const res = await authed("/tracking-api/links");
    assert.equal(res.status, 200);
    const list = (await res.json()) as any[];
    assert.equal(list[0].id, link.id, "newest link should be first");
    const summary = list.find((l) => l.id === link.id);
    assert.equal(summary.label, "Listed");
    assert.equal(summary.fullSource, "");
    assert.equal(summary.url, `/t/${link.slug}`);
    assert.equal(summary.opens, 0);
    assert.equal(summary.engagedOpens, 0);
    assert.equal(summary.wallets, 0);
    assert.equal(summary.bridgedWallets, 0);
    assert.equal(summary.bridgeValueUsd, 0);
    assert.equal(summary.active, true);
  });

  it("returns link detail and 404 for unknown ids", async () => {
    const link = await createLink({ label: "Detail" });
    const res = await authed(`/tracking-api/links/${link.id}`);
    assert.equal(res.status, 200);
    const detail = (await res.json()) as any;
    assert.equal(detail.id, link.id);
    assert.deepEqual(detail.bridgeIns, []);
    assert.deepEqual(detail.activity, []);
    assert.deepEqual(detail.walletSummaries, []);
    assert.deepEqual(detail.geoPoints, []);
    assert.ok(Array.isArray(detail.history), "history series present");

    assert.equal((await authed("/tracking-api/links/999999999")).status, 404);
    assert.equal((await authed("/tracking-api/links/not-a-number")).status, 404);
  });

  it("PATCH edits label/source/fullSource/destination and toggles active", async () => {
    const link = await createLink({ label: "Before", source: "X", destination: "/dashboard" });
    const res = await authed(`/tracking-api/links/${link.id}`, {
      method: "PATCH",
      body: { label: "After", source: "LinkedIn", fullSource: "detail", destination: "/dashboard/earn", active: false },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { id: link.id, active: false });
    const { rows } = await sql("SELECT label, source, full_source, destination, active FROM tracking_links WHERE id = $1", [link.id]);
    assert.deepEqual(rows[0], { label: "After", source: "LinkedIn", full_source: "detail", destination: "/dashboard/earn", active: false });

    assert.equal((await authed(`/tracking-api/links/${link.id}`, { method: "PATCH", body: {} })).status, 400);
    assert.equal((await authed(`/tracking-api/links/${link.id}`, { method: "PATCH", body: { destination: "//evil" } })).status, 400);
    assert.equal(
      (await authed(`/tracking-api/links/999999999`, { method: "PATCH", body: { active: true } })).status,
      404
    );
  });

  it("wallet drill-down validates the address and 404s unknown wallets", async () => {
    const link = await createLink({ label: "Wallets" });
    assert.equal((await authed(`/tracking-api/links/${link.id}/wallets/nope`)).status, 400);
    assert.equal(
      (await authed(`/tracking-api/links/${link.id}/wallets/${"ab".repeat(20)}`)).status,
      404
    );
  });
});
