import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  BOT_UA,
  BROWSER_UA,
  DEFAULT_DESTINATION,
  api,
  authed,
  createLink,
  db,
  openLink,
  sql,
  waitForReady,
} from "./helpers";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The resolver records the session fire-and-forget after sending the 302
const sessionRow = async (sessionId: string, attempts = 20): Promise<any> => {
  for (let i = 0; i < attempts; i++) {
    const { rows } = await sql("SELECT * FROM tracking_sessions WHERE id = $1", [sessionId]);
    if (rows.length) return rows[0];
    await sleep(100);
  }
  throw new Error(`session ${sessionId} never persisted`);
};

describe("GET /t/:slug resolver", () => {
  before(() => waitForReady());
  after(() => db.end());

  it("redirects a browser to the link destination and sets the HttpOnly session cookie", async () => {
    const link = await createLink({ destination: "/dashboard/swap" });
    const { res, cookie, sessionId } = await openLink(link.slug);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/dashboard/swap");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.ok(cookie, "strato_tid cookie missing");
    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith("strato_tid="))!;
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.match(setCookie, /Max-Age=7776000/);
    assert.match(sessionId!, /^[0-9a-f-]{36}$/);

    const session = await sessionRow(sessionId!);
    assert.equal(String(session.link_id), link.id);
    assert.equal(session.is_bot_or_preview, false);
    assert.equal(session.user_agent, BROWSER_UA);
    assert.equal(session.engaged_at, null);
  });

  it("records bots/previews without a cookie", async () => {
    const link = await createLink();
    const { res, cookie } = await openLink(link.slug, BOT_UA);
    assert.equal(res.status, 302);
    assert.equal(cookie, null);
    await sleep(300);
    const { rows } = await sql("SELECT is_bot_or_preview FROM tracking_sessions WHERE link_id = $1", [link.id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].is_bot_or_preview, true);
  });

  it("treats a missing User-Agent and HEAD requests as bots", async () => {
    const link = await createLink();
    const noUa = await api(`/t/${link.slug}`, { headers: { "User-Agent": "" } });
    assert.equal(noUa.status, 302);
    assert.equal(noUa.headers.getSetCookie().length, 0);
    const head = await api(`/t/${link.slug}`, { method: "HEAD", headers: { "User-Agent": BROWSER_UA } });
    assert.equal(head.status, 302);
    assert.equal(head.headers.getSetCookie().length, 0);
  });

  it("falls back to the default destination for unknown slugs (no cookie, no session)", async () => {
    const { res, cookie } = await openLink("doesnotexist");
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), DEFAULT_DESTINATION);
    assert.equal(cookie, null);
  });

  it("sends inactive links to the default destination but still records the open", async () => {
    const link = await createLink({ destination: "/dashboard/swap" });
    const patch = await authed(`/tracking-api/links/${link.id}`, { method: "PATCH", body: { active: false } });
    assert.equal(patch.status, 200);
    const { res, sessionId } = await openLink(link.slug);
    assert.equal(res.headers.get("location"), DEFAULT_DESTINATION);
    const session = await sessionRow(sessionId!);
    assert.equal(String(session.link_id), link.id);
  });

  it("destination edits take effect immediately (slug cache invalidated)", async () => {
    const link = await createLink({ destination: "/dashboard/swap" });
    assert.equal((await openLink(link.slug)).res.headers.get("location"), "/dashboard/swap");
    await authed(`/tracking-api/links/${link.id}`, { method: "PATCH", body: { destination: "https://docs.strato.nexus/x" } });
    assert.equal((await openLink(link.slug)).res.headers.get("location"), "https://docs.strato.nexus/x");
  });

  it("stores the forwarded client IP", async () => {
    const link = await createLink();
    const res = await api(`/t/${link.slug}`, {
      headers: { "User-Agent": BROWSER_UA, "X-Forwarded-For": "203.0.113.9" },
    });
    const sessionId = res.headers.getSetCookie().find((c) => c.startsWith("strato_tid="))!.split(";")[0].split("=")[1];
    const session = await sessionRow(sessionId);
    assert.equal(session.ip_address, "203.0.113.9");
  });
});
