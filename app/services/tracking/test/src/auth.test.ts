import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { api, db, token, waitForReady } from "./helpers";

describe("dashboard auth", () => {
  before(() => waitForReady());
  after(() => db.end());

  it("GET /tracking-api/me is false without a token and true for an allowlisted user", async () => {
    const anon = await api("/tracking-api/me");
    assert.equal(anon.status, 200);
    assert.deepEqual(await anon.json(), { authorized: false });

    const ok = await api("/tracking-api/me", { auth: await token() });
    assert.deepEqual(await ok.json(), { authorized: true });

    const stranger = await api("/tracking-api/me", { auth: await token("stranger@example.com") });
    assert.deepEqual(await stranger.json(), { authorized: false });
  });

  it("protected routes reject missing (401), unlisted (403), and garbage (401) tokens", async () => {
    assert.equal((await api("/tracking-api/links")).status, 401);
    assert.equal((await api("/tracking-api/links", { auth: await token("stranger@example.com") })).status, 403);
    assert.equal((await api("/tracking-api/links", { auth: "not.a.jwt" })).status, 401);
    assert.equal((await api("/tracking-api/links", { method: "POST", body: { label: "x" } })).status, 401);
  });

  it("accepts the edge-injected X-USER-ACCESS-TOKEN header", async () => {
    const res = await api("/tracking-api/me", { headers: { "X-USER-ACCESS-TOKEN": await token() } });
    assert.deepEqual(await res.json(), { authorized: true });
  });
});
