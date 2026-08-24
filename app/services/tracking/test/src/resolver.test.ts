import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  BOT_UA,
  BROWSER_UA,
  DEFAULT_DESTINATION,
  IN_APP_BROWSER_UA,
  PREVIEW_UA,
  TRACKING_URL,
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
    const location = (await openLink(link.slug)).res.headers.get("location")!;
    // Cross-host destination: same URL plus the session id (see below)
    assert.equal(new URL(location).origin + new URL(location).pathname, "https://docs.strato.nexus/x");
  });

  it("carries the session id in the URL when the destination is on another host", async () => {
    const link = await createLink({ destination: "https://app.example.com/dashboard/deposits?ref=x" });
    const { res, sessionId } = await openLink(link.slug);
    const location = new URL(res.headers.get("location")!);
    assert.equal(location.host, "app.example.com");
    assert.equal(location.searchParams.get("ref"), "x", "existing query params are kept");
    assert.equal(location.searchParams.get("stid"), sessionId, "stid must match the cookie session");

    // Same host as the request: the cookie already covers it, URL untouched
    const sameHost = await createLink({ destination: `${TRACKING_URL}/dashboard/deposits` });
    const sameHostRes = await openLink(sameHost.slug);
    assert.equal(
      sameHostRes.res.headers.get("location"),
      `${TRACKING_URL}/dashboard/deposits`
    );

    // Relative destinations are never rewritten either
    const relative = await createLink({ destination: "/dashboard/swap" });
    assert.equal((await openLink(relative.slug)).res.headers.get("location"), "/dashboard/swap");

    // A bot gets neither cookie nor stid
    const botRes = await openLink(link.slug, BOT_UA);
    assert.equal(botRes.cookie, null);
    assert.equal(
      new URL(botRes.res.headers.get("location")!).searchParams.get("stid"),
      null
    );
  });

  it("counts a mobile in-app browser as a visitor and records the ambiguous token", async () => {
    const link = await createLink();
    const { res, cookie, sessionId } = await openLink(link.slug, IN_APP_BROWSER_UA);
    assert.equal(res.status, 302);
    assert.ok(cookie, "in-app browsers must get a session cookie");
    const session = await sessionRow(sessionId!);
    assert.equal(session.is_bot_or_preview, false);
    assert.equal(session.bot_reason, "browser-ua:whatsapp");
  });

  it("still filters the preview fetcher of the same app, and records why", async () => {
    const link = await createLink();
    const preview = await openLink(link.slug, PREVIEW_UA);
    assert.equal(preview.cookie, null);
    const facebook = await openLink(link.slug, "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)");
    assert.equal(facebook.cookie, null);
    const noUa = await api(`/t/${link.slug}`, { headers: { "User-Agent": "" } });
    assert.equal(noUa.status, 302);
    await sleep(300);

    const { rows } = await sql(
      "SELECT bot_reason, is_bot_or_preview FROM tracking_sessions WHERE link_id = $1 ORDER BY opened_at",
      [link.id]
    );
    assert.equal(rows.length, 3);
    assert.ok(rows.every((row: any) => row.is_bot_or_preview === true));
    assert.deepEqual(
      rows.map((row: any) => row.bot_reason).sort(),
      ["ambiguous-ua:whatsapp", "bot-ua:facebookexternalhit", "no-user-agent"]
    );
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
