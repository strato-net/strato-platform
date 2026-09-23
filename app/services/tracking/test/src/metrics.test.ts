import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, describe, it } from "node:test";
import {
  api,
  authed,
  BOT_UA,
  cirrusAddress,
  createLink,
  db,
  isoIn,
  openLink,
  randomAddress,
  resetCirrus,
  seedCirrus,
  sql,
  token,
  waitForReady,
} from "./helpers";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const DAY_MS = 24 * 60 * 60 * 1000;
const DEPOSITS = "BlockApps-MercataBridge-DepositCompleted";
const PRICES = "BlockApps-PriceOracle-prices";
const EVENTS = "event";
const WEI = (n: number) => (BigInt(n) * 10n ** 18n).toString();

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

const snapshot = async (period?: string): Promise<any> => {
  const res = await authed(
    `/tracking-api/metrics/daily${period === undefined ? "" : `?period=${period}`}`
  );
  assert.equal(res.status, 200);
  return res.json();
};

// The suite shares one database, so every assertion is a delta against a
// baseline taken immediately before the test's own writes.
const utcDayStart = (): number => {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
};

const dayString = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

// Midday yesterday (UTC): inside yesterday's whole-day window whatever time
// of day the suite runs at, and never inside today's or the 7d/30d baseline.
const yesterdayMidday = (): Date => new Date(utcDayStart() - DAY_MS / 2);

// A moment inside yesterday's "same elapsed window" (>= yesterday 00:00 UTC,
// < now - 24h). Waits out the first seconds of a UTC day, where that window
// is too short to place anything in.
const yesterdayInWindow = async (): Promise<Date> => {
  const elapsed = Date.now() - utcDayStart();
  if (elapsed < 5_000) await sleep(5_000 - elapsed);
  const offset = Math.min(60_000, Math.floor((Date.now() - utcDayStart()) / 2));
  return new Date(Date.now() - DAY_MS - offset);
};

// opened_at/connected_at are server-generated, so a backdated window can only
// be built by writing the rows directly.
const insertBackdatedSession = async (
  linkId: string,
  openedAt: Date,
  engaged: boolean
): Promise<string> => {
  const id = crypto.randomUUID();
  await sql(
    `INSERT INTO tracking_sessions (id, link_id, opened_at, engaged_at, user_agent, is_bot_or_preview)
     VALUES ($1, $2, $3, $4, 'backdated-metrics-test', FALSE)`,
    [id, linkId, openedAt, engaged ? openedAt : null]
  );
  return id;
};

describe("daily metrics snapshot", () => {
  before(async () => {
    await waitForReady();
    await resetCirrus();
  });
  after(async () => {
    await resetCirrus();
    await db.end();
  });

  it("is dashboard-only: 401 without a token, 403 for a user off the allowlist", async () => {
    assert.equal((await api("/tracking-api/metrics/daily")).status, 401);
    assert.equal(
      (await api("/tracking-api/metrics/daily", { auth: await token("stranger@example.com") })).status,
      403
    );
    const snap = await snapshot();
    for (const key of [
      "date",
      "generatedAt",
      "hour",
      "linksTotal",
      "linksWithOpens",
      "opens",
      "engagedOpens",
      "wallets",
      "bridgedWallets",
      "bridgeValueUsd",
      "bridgeValuePartial",
      "bridgeIns",
      "actions",
      "actionLinks",
      "opensByHour",
      "topLinks",
    ]) {
      assert.ok(key in snap, `${key} missing from the daily snapshot`);
    }
    assert.equal(snap.date, new Date().toISOString().slice(0, 10));
    assert.ok(snap.hour >= 0 && snap.hour <= 23, `hour out of range: ${snap.hour}`);
    assert.equal(snap.opensByHour.length, 24);
  });

  it("rolls up today's opens by hour and ranks the busiest links, ignoring bots", async () => {
    const base = await snapshot();
    const link = await createLink({ label: "Snapshot opens", source: "discord" });

    let engagedCookie: string | null = null;
    for (let i = 0; i < 5; i++) {
      const opened = await openLink(link.slug);
      engagedCookie = engagedCookie ?? opened.cookie;
    }
    await openLink(link.slug, BOT_UA);
    await sleep(400);
    await api("/tracking-api/engage", { method: "POST", cookie: engagedCookie });

    const snap = await snapshot();
    assert.equal(snap.opens.value - base.opens.value, 5, "bot opens must not count");
    assert.equal(snap.engagedOpens - base.engagedOpens, 1);
    assert.equal(snap.linksWithOpens - base.linksWithOpens, 1);
    assert.equal(snap.linksTotal - base.linksTotal, 1);

    assert.equal(sum(snap.opensByHour), snap.opens.value, "hour buckets must sum to today's opens");
    assert.equal(sum(snap.opensByHour) - sum(base.opensByHour), 5);

    // 5 opens beats every other link in the suite, so ours leads the list
    assert.equal(snap.topLinks[0].id, link.id);
    assert.equal(snap.topLinks[0].opens, 5);
    assert.equal(snap.topLinks[0].slug, link.slug);
    assert.equal(snap.topLinks[0].label, "Snapshot opens");
    assert.equal(snap.topLinks[0].source, "discord");
    assert.ok(snap.topLinks.length <= 6, "top links list is capped at 6");
  });

  it("counts today's attributed wallets, bridge-ins and on-chain actions", async () => {
    const base = await snapshot();
    const link = await createLink({ label: "Snapshot chain" });
    const { cookie } = await openLink(link.slug);
    await sleep(300);
    const external = randomAddress();
    const strato = randomAddress();
    const priced = cirrusAddress(randomAddress());
    await api("/tracking-api/wallet-connected", {
      method: "POST",
      cookie,
      body: { externalWalletAddress: external, stratoAddress: strato, connector: "MetaMask" },
    });

    await seedCirrus(DEPOSITS, [
      {
        id: 9101,
        externalChainId: 1,
        externalSender: cirrusAddress(external),
        externalTxHash: "0xext9101",
        stratoRecipient: cirrusAddress(strato),
        stratoToken: priced,
        stratoTokenAmount: WEI(2),
        block_timestamp: isoIn(1000),
        transaction_hash: "strato9101",
      },
    ]);
    await seedCirrus(PRICES, [{ key: priced, value: WEI(3000) }]);
    await seedCirrus(EVENTS, [
      {
        id: 9501,
        address: "pool000000000000000000000000000000009501",
        contract_name: "Pool",
        event_name: "Swap",
        block_timestamp: isoIn(2000),
        attributes: { sender: cirrusAddress(strato), amountIn: WEI(1) },
      },
    ]);

    const snap = await snapshot();
    assert.equal(snap.wallets.value - base.wallets.value, 1);
    assert.equal(snap.bridgedWallets - base.bridgedWallets, 1);
    assert.equal(snap.bridgeIns - base.bridgeIns, 1);
    assert.equal(snap.bridgeValueUsd.value - base.bridgeValueUsd.value, 6000);
    assert.equal(snap.bridgeValuePartial, false);
    assert.equal(snap.actions.value - base.actions.value, 1, "the swap is one on-chain action");
    assert.equal(snap.actionLinks - base.actionLinks, 1);

    // An unpriced token makes the USD figure a floor, not a total
    const unpriced = cirrusAddress(randomAddress());
    await seedCirrus(DEPOSITS, [
      {
        id: 9102,
        externalChainId: 1,
        externalSender: cirrusAddress(external),
        externalTxHash: "0xext9102",
        stratoRecipient: cirrusAddress(strato),
        stratoToken: unpriced,
        stratoTokenAmount: WEI(5),
        block_timestamp: isoIn(1000),
        transaction_hash: "strato9102",
      },
    ]);
    const withUnpriced = await snapshot();
    assert.equal(withUnpriced.bridgeValuePartial, true);
    assert.equal(withUnpriced.bridgeIns - snap.bridgeIns, 1);
    assert.equal(withUnpriced.bridgeValueUsd.value, snap.bridgeValueUsd.value);
  });

  it("compares every headline metric against the same elapsed window yesterday", async () => {
    const base = await snapshot();
    const link = await createLink({ label: "Snapshot yesterday" });
    const backdated = await yesterdayInWindow();
    const sessionId = await insertBackdatedSession(link.id, backdated, true);
    await insertBackdatedSession(link.id, backdated, false);

    const strato = randomAddress();
    const tokenAddress = cirrusAddress(randomAddress());
    await sql(
      `INSERT INTO wallet_connections (session_id, link_id, external_wallet_address, strato_address, connector, connected_at)
       VALUES ($1, $2, '', $3, 'Backdated', $4)`,
      [sessionId, link.id, cirrusAddress(strato), backdated]
    );
    await seedCirrus(DEPOSITS, [
      {
        id: 9201,
        externalChainId: 1,
        externalSender: cirrusAddress(randomAddress()),
        externalTxHash: "0xext9201",
        stratoRecipient: cirrusAddress(strato),
        stratoToken: tokenAddress,
        stratoTokenAmount: WEI(2),
        block_timestamp: new Date(backdated.getTime() + 1000).toISOString(),
        transaction_hash: "strato9201",
      },
    ]);
    await seedCirrus(PRICES, [{ key: tokenAddress, value: WEI(3000) }]);
    await seedCirrus(EVENTS, [
      {
        id: 9601,
        address: "cdp0000000000000000000000000000000009601",
        contract_name: "CDPEngine",
        event_name: "USDSTMinted",
        block_timestamp: new Date(backdated.getTime() + 2000).toISOString(),
        attributes: { owner: cirrusAddress(strato), amount: WEI(10) },
      },
    ]);

    const snap = await snapshot();
    assert.equal(snap.opens.previous - base.opens.previous, 2);
    assert.equal(snap.wallets.previous - base.wallets.previous, 1);
    assert.equal(snap.bridgeValueUsd.previous - base.bridgeValueUsd.previous, 6000);
    assert.equal(snap.actions.previous - base.actions.previous, 1);

    // …and yesterday's rows never leak into today's numbers
    assert.equal(snap.opens.value, base.opens.value);
    assert.equal(snap.wallets.value, base.wallets.value);
    assert.equal(snap.bridgeValueUsd.value, base.bridgeValueUsd.value);
    assert.equal(snap.actions.value, base.actions.value);
    assert.equal(snap.linksWithOpens, base.linksWithOpens);

    for (const metric of [snap.opens, snap.wallets, snap.bridgeValueUsd, snap.actions]) {
      assert.equal(
        metric.changePct,
        metric.previous > 0
          ? Math.round(((metric.value - metric.previous) / metric.previous) * 1000) / 10
          : null,
        "changePct must follow value/previous (null without a baseline)"
      );
    }
  });

  it("windows every metric by ?period and rejects an unknown one", async () => {
    assert.equal((await authed("/tracking-api/metrics/daily?period=week")).status, 400);
    assert.equal((await authed("/tracking-api/metrics/daily?period=")).status, 200);

    // No period at all still means today (the endpoint stays compatible)
    const implicit = await snapshot();
    const today = await snapshot("today");
    assert.equal(implicit.period, "today");
    assert.equal(today.period, "today");
    assert.equal(today.days, 1);
    assert.equal(today.date, dayString(utcDayStart()));
    assert.equal(today.startDate, today.date);
    assert.equal(today.endDate, today.date);

    const yesterday = await snapshot("yesterday");
    assert.equal(yesterday.days, 1);
    assert.equal(yesterday.date, dayString(utcDayStart() - DAY_MS));
    assert.equal(yesterday.startDate, yesterday.date);

    const week = await snapshot("7d");
    assert.equal(week.days, 7);
    assert.equal(week.endDate, today.date, "a trailing window ends today");
    assert.equal(week.startDate, dayString(utcDayStart() - 6 * DAY_MS));

    const month = await snapshot("30d");
    assert.equal(month.days, 30);
    assert.equal(month.endDate, today.date);
    assert.equal(month.startDate, dayString(utcDayStart() - 29 * DAY_MS));

    // Every window keeps the snapshot's shape, and a longer one can only
    // contain more of the suite's opens than the shorter one inside it
    for (const snap of [yesterday, week, month]) {
      assert.equal(snap.opensByHour.length, 24);
      assert.equal(sum(snap.opensByHour), snap.opens.value);
      assert.ok(snap.topLinks.length <= 6);
    }
    assert.ok(week.opens.value >= today.opens.value);
    assert.ok(month.opens.value >= week.opens.value);
    assert.ok(month.opens.value >= yesterday.opens.value);
  });

  it("counts yesterday's rows under period=yesterday, and the trailing windows contain both days", async () => {
    const baseToday = await snapshot("today");
    const baseYesterday = await snapshot("yesterday");
    const baseWeek = await snapshot("7d");
    const link = await createLink({ label: "Snapshot period window" });
    const backdated = yesterdayMidday();
    const sessionId = await insertBackdatedSession(link.id, backdated, true);

    const strato = randomAddress();
    const tokenAddress = cirrusAddress(randomAddress());
    await sql(
      `INSERT INTO wallet_connections (session_id, link_id, external_wallet_address, strato_address, connector, connected_at)
       VALUES ($1, $2, '', $3, 'Backdated', $4)`,
      [sessionId, link.id, cirrusAddress(strato), backdated]
    );
    await seedCirrus(DEPOSITS, [
      {
        id: 9301,
        externalChainId: 1,
        externalSender: cirrusAddress(randomAddress()),
        externalTxHash: "0xext9301",
        stratoRecipient: cirrusAddress(strato),
        stratoToken: tokenAddress,
        stratoTokenAmount: WEI(1),
        block_timestamp: new Date(backdated.getTime() + 1000).toISOString(),
        transaction_hash: "strato9301",
      },
    ]);
    await seedCirrus(PRICES, [{ key: tokenAddress, value: WEI(2000) }]);

    const yesterday = await snapshot("yesterday");
    assert.equal(yesterday.opens.value - baseYesterday.opens.value, 1);
    assert.equal(yesterday.engagedOpens - baseYesterday.engagedOpens, 1);
    assert.equal(yesterday.wallets.value - baseYesterday.wallets.value, 1);
    assert.equal(yesterday.bridgeIns - baseYesterday.bridgeIns, 1);
    assert.equal(yesterday.bridgeValueUsd.value - baseYesterday.bridgeValueUsd.value, 2000);
    assert.equal(
      yesterday.linksWithOpens - baseYesterday.linksWithOpens,
      1,
      "the link is active in yesterday's window"
    );

    // …the same rows also sit inside the trailing 7-day window…
    const week = await snapshot("7d");
    assert.equal(week.opens.value - baseWeek.opens.value, 1);
    assert.equal(week.wallets.value - baseWeek.wallets.value, 1);
    assert.equal(week.bridgeValueUsd.value - baseWeek.bridgeValueUsd.value, 2000);

    // …and never in today's
    const today = await snapshot("today");
    assert.equal(today.opens.value, baseToday.opens.value, "yesterday's open is not today's");
    assert.equal(today.wallets.value, baseToday.wallets.value);
    assert.equal(today.bridgeValueUsd.value, baseToday.bridgeValueUsd.value);
  });
});
