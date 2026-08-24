import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  api,
  authed,
  BOT_UA,
  cirrusAddress,
  createLink,
  db,
  openLink,
  randomAddress,
  sql,
  waitForReady,
} from "./helpers";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_GEO_VISITS_PER_LINK = 5000;

interface Spot {
  lat: number;
  lon: number;
  city: string;
  country: string;
}

const PARIS: Spot = { lat: 48.8566, lon: 2.3522, city: "Paris", country: "FR" };
const TOKYO: Spot = { lat: 35.6762, lon: 139.6503, city: "Tokyo", country: "JP" };

interface GeoVisit {
  at: string;
  address: string | null;
}

interface GeoPoint {
  lat: number;
  lon: number;
  city: string | null;
  country: string | null;
  count: number;
  visits: GeoVisit[];
}

interface LinkDetail {
  geoPoints: GeoPoint[];
  geoTruncated: boolean;
}

// The resolver records the session fire-and-forget after sending the 302
const sessionRow = async (sessionId: string, attempts = 30): Promise<any> => {
  for (let i = 0; i < attempts; i++) {
    const { rows } = await sql("SELECT * FROM tracking_sessions WHERE id = $1", [sessionId]);
    if (rows.length) return rows[0];
    await sleep(100);
  }
  throw new Error(`session ${sessionId} never persisted`);
};

// opened_at and the geo columns are server-side (offline geoip has nothing to
// say about a docker-internal IP), so the map fixture is written directly.
const setGeo = async (sessionId: string, spot: Spot, openedAt: Date): Promise<void> => {
  await sql(
    `UPDATE tracking_sessions
     SET geo_lat = $2, geo_lon = $3, geo_city = $4, geo_country = $5, opened_at = $6
     WHERE id = $1`,
    [sessionId, spot.lat, spot.lon, spot.city, spot.country, openedAt]
  );
};

const openWithGeo = async (slug: string, spot: Spot, openedAt: Date): Promise<string> => {
  const { sessionId } = await openLink(slug);
  assert.ok(sessionId, "browser open must set a session cookie");
  await sessionRow(sessionId!);
  await setGeo(sessionId!, spot, openedAt);
  return sessionId!;
};

const detailOf = async (linkId: string): Promise<LinkDetail> => {
  const res = await authed(`/tracking-api/links/${linkId}`);
  assert.equal(res.status, 200, `link detail ${linkId}: ${res.status}`);
  return (await res.json()) as LinkDetail;
};

describe("visitor map payload", () => {
  before(() => waitForReady());
  after(() => db.end());

  it("returns one map point per coordinate with per-visit timestamps", async () => {
    const link = await createLink({ label: "Geo points" });
    const base = Date.now() - 6 * HOUR_MS;
    const first = new Date(base);
    const second = new Date(base + HOUR_MS);
    const third = new Date(base + 2 * HOUR_MS);

    await openWithGeo(link.slug, PARIS, first);
    await openWithGeo(link.slug, PARIS, second);
    await openWithGeo(link.slug, TOKYO, third);

    const detail = await detailOf(link.id);
    assert.equal(detail.geoPoints.length, 2, "two distinct coordinates");
    assert.equal(detail.geoTruncated, false);

    // Points come back busiest-first
    const [paris, tokyo] = detail.geoPoints;
    assert.equal(paris.city, "Paris");
    assert.equal(paris.country, "FR");
    assert.equal(paris.lat, PARIS.lat);
    assert.equal(paris.lon, PARIS.lon);
    assert.equal(paris.count, 2);
    assert.equal(paris.visits.length, paris.count);
    assert.deepEqual(
      paris.visits.map((visit) => visit.at),
      [second.toISOString(), first.toISOString()],
      "visits are newest first"
    );

    assert.equal(tokyo.city, "Tokyo");
    assert.equal(tokyo.count, 1);
    assert.equal(tokyo.visits.length, 1);
    assert.equal(tokyo.visits[0].at, third.toISOString());
  });

  it("carries the session's wallet identity (external first) and nothing else", async () => {
    const link = await createLink({ label: "Geo identity" });
    const base = Date.now() - 5 * HOUR_MS;
    const connectedAt = new Date(base);
    const anonymousAt = new Date(base + HOUR_MS);

    const identified = await openWithGeo(link.slug, PARIS, connectedAt);
    await openWithGeo(link.slug, PARIS, anonymousAt);

    const external = randomAddress();
    const strato = randomAddress();
    await api("/tracking-api/wallet-connected", {
      method: "POST",
      cookie: `strato_tid=${identified}`,
      body: { externalWalletAddress: external, stratoAddress: strato, connector: "MetaMask" },
    });
    await sleep(300);

    const detail = await detailOf(link.id);
    assert.equal(detail.geoPoints.length, 1);
    const [point] = detail.geoPoints;
    assert.equal(point.count, 2);
    assert.deepEqual(
      point.visits.map((visit) => visit.address),
      [null, cirrusAddress(external)],
      "the newest (anonymous) visit has no address; the connected one uses the external address"
    );

    const serialized = JSON.stringify(detail.geoPoints);
    assert.ok(!/"ip"/i.test(serialized), "no raw IP in the map payload");
    assert.ok(!/ipAddress/i.test(serialized), "no raw IP in the map payload");
    assert.ok(!serialized.includes(cirrusAddress(strato)), "external address wins the identity");
  });

  it("exposes an address that resolves to a user timeline", async () => {
    const link = await createLink({ label: "Geo timeline" });
    const sessionId = await openWithGeo(link.slug, TOKYO, new Date(Date.now() - 2 * HOUR_MS));
    const external = randomAddress();
    await api("/tracking-api/wallet-connected", {
      method: "POST",
      cookie: `strato_tid=${sessionId}`,
      body: { externalWalletAddress: external, connector: "MetaMask" },
    });
    await sleep(300);

    const detail = await detailOf(link.id);
    const address = detail.geoPoints[0]?.visits[0]?.address;
    assert.equal(address, cirrusAddress(external));

    // What the dashboard navigates to when the dot is clicked
    const res = await authed(`/tracking-api/users/${address}/timeline`);
    assert.equal(res.status, 200);
    const timeline = (await res.json()) as { items: { kind: string; linkId: string | null }[] };
    assert.ok(
      timeline.items.some((item) => item.kind === "link_opened" && item.linkId === link.id),
      "the visitor's timeline shows the open behind the dot"
    );
  });

  it("never maps bots, previews or sessions without coordinates", async () => {
    const link = await createLink({ label: "Geo exclusions" });
    const at = new Date(Date.now() - 4 * HOUR_MS);
    await openWithGeo(link.slug, PARIS, at);

    // A bot open with coordinates written anyway…
    await openLink(link.slug, BOT_UA);
    let botId: string | null = null;
    for (let i = 0; i < 30 && !botId; i++) {
      const { rows } = await sql(
        "SELECT id FROM tracking_sessions WHERE link_id = $1 AND is_bot_or_preview",
        [link.id]
      );
      botId = rows[0]?.id ?? null;
      if (!botId) await sleep(100);
    }
    assert.ok(botId, "bot session never persisted");
    await setGeo(botId!, TOKYO, at);

    // …and a browser open the geo lookup never resolved
    const { sessionId } = await openLink(link.slug);
    await sessionRow(sessionId!);
    await sql("UPDATE tracking_sessions SET geo_lat = NULL, geo_lon = NULL WHERE id = $1", [
      sessionId,
    ]);

    const detail = await detailOf(link.id);
    assert.equal(detail.geoPoints.length, 1, "only the geolocated browser open is mapped");
    assert.equal(detail.geoPoints[0].city, "Paris");
    assert.equal(detail.geoPoints[0].count, 1);
    assert.equal(detail.geoTruncated, false);
  });

  it("caps the per-link visit list and flags the truncation", async () => {
    const link = await createLink({ label: "Geo cap" });
    const total = MAX_GEO_VISITS_PER_LINK + 50;
    // Backdated well outside the daily-metrics windows so the rest of the
    // suite is unaffected; one second apart so the newest is unambiguous.
    const start = new Date(Date.now() - 200 * DAY_MS);
    await sql(
      `INSERT INTO tracking_sessions
         (id, link_id, opened_at, user_agent, is_bot_or_preview, geo_lat, geo_lon, geo_city, geo_country)
       SELECT gen_random_uuid(), $1::bigint, $2::timestamptz + (g || ' seconds')::interval,
              'geo-cap-test', FALSE, $3::double precision, $4::double precision, $5::text, $6::text
       FROM generate_series(1, $7::int) AS g`,
      [link.id, start, TOKYO.lat, TOKYO.lon, TOKYO.city, TOKYO.country, total]
    );

    const detail = await detailOf(link.id);
    assert.equal(detail.geoTruncated, true);
    const mapped = detail.geoPoints.reduce((sum, point) => sum + point.visits.length, 0);
    assert.equal(mapped, MAX_GEO_VISITS_PER_LINK, "only the newest visits are mapped");
    assert.equal(detail.geoPoints[0].count, MAX_GEO_VISITS_PER_LINK);
    assert.equal(
      detail.geoPoints[0].visits[0].at,
      new Date(start.getTime() + total * 1000).toISOString(),
      "the newest inserted open leads the list"
    );

    // Keep the shared database (and every later snapshot rebuild) small
    await sql("DELETE FROM tracking_sessions WHERE link_id = $1", [link.id]);
  });
});
