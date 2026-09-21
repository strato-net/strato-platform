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

// GET /tracking-api/metrics/daily/breakdown — the rows behind the four Daily
// Snapshot tiles. The suite shares one database, so every assertion is a
// delta against a baseline taken right before the test's own writes, and row
// assertions look for this test's own link/wallet rather than a row position.

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const DAY_MS = 24 * 60 * 60 * 1000;
const DEPOSITS = "BlockApps-MercataBridge-DepositCompleted";
const PRICES = "BlockApps-PriceOracle-prices";
const EVENTS = "event";
const WEI = (n: number) => (BigInt(n) * 10n ** 18n).toString();

const breakdown = async (): Promise<any> => {
  const res = await authed("/tracking-api/metrics/daily/breakdown");
  assert.equal(res.status, 200);
  return res.json();
};

const snapshot = async (): Promise<any> => {
  const res = await authed("/tracking-api/metrics/daily");
  assert.equal(res.status, 200);
  return res.json();
};

describe("daily snapshot breakdown", () => {
  before(async () => {
    await waitForReady();
    await resetCirrus();
  });
  after(async () => {
    await resetCirrus();
    await db.end();
  });

  it("is dashboard-only and shaped like four sections", async () => {
    assert.equal((await api("/tracking-api/metrics/daily/breakdown")).status, 401);
    assert.equal(
      (
        await api("/tracking-api/metrics/daily/breakdown", {
          auth: await token("stranger@example.com"),
        })
      ).status,
      403
    );

    const data = await breakdown();
    assert.equal(data.date, new Date().toISOString().slice(0, 10));
    for (const key of ["opens", "wallets", "bridgeIns", "actions"]) {
      const section = data[key];
      assert.ok(section, `${key} section missing`);
      assert.ok(Array.isArray(section.rows), `${key}.rows must be an array`);
      assert.equal(section.shown, section.rows.length);
      assert.equal(section.truncated, section.shown < section.total);
      assert.ok(section.total >= section.shown, `${key}.total must cover the rows shown`);
    }
    assert.ok(Array.isArray(data.actions.byCategory));
    assert.equal(typeof data.bridgeIns.valueUsd, "number");
    assert.equal(typeof data.bridgeIns.valuePartial, "boolean");
  });

  it("lists today's opens with link, engagement and geo, and skips bots", async () => {
    const base = await breakdown();
    const link = await createLink({ label: "Breakdown opens", source: "discord" });
    const { cookie, sessionId } = await openLink(link.slug);
    await openLink(link.slug, BOT_UA);
    await sleep(400);
    await api("/tracking-api/engage", { method: "POST", cookie });
    // Geo is filled by the offline geoip database, which has nothing to say
    // about the test's loopback address
    await sql(
      `UPDATE tracking_sessions SET geo_city = 'Testville', geo_country = 'Testland', referrer = 'https://x.com/post/1'
       WHERE id = $1`,
      [sessionId]
    );

    const data = await breakdown();
    assert.equal(data.opens.total - base.opens.total, 1, "the bot open must not count");

    const rows = data.opens.rows.filter((row: any) => row.link?.id === link.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].engaged, true);
    assert.equal(rows[0].city, "Testville");
    assert.equal(rows[0].country, "Testland");
    assert.equal(rows[0].referrer, "https://x.com/post/1");
    assert.equal(rows[0].link.slug, link.slug);
    assert.equal(rows[0].link.label, "Breakdown opens");
    assert.equal(rows[0].link.source, "discord");
    assert.equal(rows[0].address, null, "an anonymous visit has no wallet");

    // Newest first
    const times = data.opens.rows.map((row: any) => row.at);
    assert.deepEqual(times, [...times].sort().reverse());
  });

  it("gives each wallet its first open, link, bridged amount and actions", async () => {
    const base = await breakdown();
    const link = await createLink({ label: "Breakdown wallets" });
    const { cookie, sessionId } = await openLink(link.slug);
    await sleep(300);
    const external = randomAddress();
    const strato = randomAddress();
    const priced = cirrusAddress(randomAddress());
    await api("/tracking-api/wallet-connected", {
      method: "POST",
      cookie,
      body: { externalWalletAddress: external, stratoAddress: strato, connector: "MetaMask" },
    });
    await sql(`UPDATE tracking_sessions SET geo_city = 'Walletville' WHERE id = $1`, [sessionId]);

    await seedCirrus(DEPOSITS, [
      {
        id: 9701,
        externalChainId: 8453,
        externalSender: cirrusAddress(external),
        externalTxHash: "0xext9701",
        stratoRecipient: cirrusAddress(strato),
        stratoToken: priced,
        stratoTokenAmount: WEI(2),
        block_timestamp: isoIn(1000),
        transaction_hash: "strato9701",
      },
    ]);
    await seedCirrus(PRICES, [{ key: priced, value: WEI(1500) }]);
    await seedCirrus(EVENTS, [
      {
        id: 9801,
        address: "pool000000000000000000000000000000009801",
        contract_name: "Pool",
        event_name: "Swap",
        block_timestamp: isoIn(2000),
        attributes: { sender: cirrusAddress(strato), amountIn: WEI(1) },
      },
    ]);

    const data = await breakdown();
    assert.equal(data.wallets.total - base.wallets.total, 1);

    // Addresses are stored (and returned) in Cirrus form: lowercase, no 0x
    const row = data.wallets.rows.find((r: any) => r.address === cirrusAddress(external));
    assert.ok(row, "the connected wallet must appear in the breakdown");
    assert.equal(row.externalWalletAddress, cirrusAddress(external));
    assert.equal(row.stratoAddress, cirrusAddress(strato));
    assert.equal(row.connector, "MetaMask");
    assert.equal(row.link.id, link.id);
    assert.equal(row.city, "Walletville");
    assert.ok(row.firstOpenAt, "first open time is the open that started the session");
    assert.ok(
      new Date(row.firstOpenAt).getTime() <= new Date(row.connectedAt).getTime(),
      "the open cannot postdate the connection"
    );
    assert.equal(row.bridgeIns, 1);
    assert.equal(row.bridgeValueUsd, 3000);
    assert.equal(row.bridgeValuePartial, false);
    assert.equal(row.actions, 1);
    assert.deepEqual(row.actionSummary, { swap: 1 });
    assert.ok(row.lastActivityAt);

    // …and an unpriced token turns the wallet's USD figure into a floor
    const unpriced = cirrusAddress(randomAddress());
    await seedCirrus(DEPOSITS, [
      {
        id: 9702,
        externalChainId: 8453,
        externalSender: cirrusAddress(external),
        externalTxHash: "0xext9702",
        stratoRecipient: cirrusAddress(strato),
        stratoToken: unpriced,
        stratoTokenAmount: WEI(7),
        block_timestamp: isoIn(1000),
        transaction_hash: "strato9702",
      },
    ]);
    const withUnpriced = await breakdown();
    const partialRow = withUnpriced.wallets.rows.find(
      (r: any) => r.address === cirrusAddress(external)
    );
    assert.equal(partialRow.bridgeIns, 2);
    assert.equal(partialRow.bridgeValuePartial, true);
    assert.equal(partialRow.bridgeValueUsd, 3000, "the unpriced transfer adds no USD");
  });

  it("lists bridge-ins per wallet with asset, amount and source chain", async () => {
    const base = await breakdown();
    const link = await createLink({ label: "Breakdown bridges" });
    const { cookie } = await openLink(link.slug);
    await sleep(300);
    const external = randomAddress();
    const strato = randomAddress();
    const tokenAddress = cirrusAddress(randomAddress());
    await api("/tracking-api/wallet-connected", {
      method: "POST",
      cookie,
      body: { externalWalletAddress: external, stratoAddress: strato, connector: "MetaMask" },
    });
    await seedCirrus(DEPOSITS, [
      {
        id: 9901,
        externalChainId: 1,
        externalSender: cirrusAddress(external),
        externalTxHash: "0xext9901",
        stratoRecipient: cirrusAddress(strato),
        stratoToken: tokenAddress,
        stratoTokenAmount: WEI(4),
        block_timestamp: isoIn(1000),
        transaction_hash: "strato9901",
      },
    ]);
    await seedCirrus(PRICES, [{ key: tokenAddress, value: WEI(10) }]);

    const [data, snap] = [await breakdown(), await snapshot()];
    assert.equal(data.bridgeIns.total - base.bridgeIns.total, 1);
    // The section totals are the tile: same window, same attribution
    assert.equal(data.bridgeIns.total, snap.bridgeIns);
    assert.equal(data.bridgeIns.valuePartial, snap.bridgeValuePartial);

    const row = data.bridgeIns.rows.find((r: any) => r.externalTxHash === "0xext9901");
    assert.ok(row, "the attributed bridge-in must appear in the breakdown");
    assert.equal(row.address, cirrusAddress(strato));
    assert.equal(row.amountUsd, 40);
    assert.equal(row.chainName, "Ethereum");
    assert.equal(row.externalChainId, 1);
    assert.equal(row.txHash, "strato9901");
    assert.equal(row.link.id, link.id);
  });

  it("groups on-chain actions by type and lists them per wallet and link", async () => {
    const base = await breakdown();
    const link = await createLink({ label: "Breakdown actions" });
    const { cookie } = await openLink(link.slug);
    await sleep(300);
    const strato = randomAddress();
    await api("/tracking-api/wallet-connected", {
      method: "POST",
      cookie,
      body: { stratoAddress: strato, connector: "Keycloak" },
    });
    await seedCirrus(EVENTS, [
      {
        id: 9910,
        address: "pool000000000000000000000000000000009910",
        contract_name: "Pool",
        event_name: "Swap",
        block_timestamp: isoIn(1000),
        attributes: { sender: cirrusAddress(strato), amountIn: WEI(1) },
      },
      {
        id: 9911,
        address: "pool000000000000000000000000000000009911",
        contract_name: "Pool",
        event_name: "Swap",
        block_timestamp: isoIn(2000),
        attributes: { sender: cirrusAddress(strato), amountIn: WEI(2) },
      },
      {
        id: 9912,
        address: "cdp0000000000000000000000000000000009912",
        contract_name: "CDPEngine",
        event_name: "USDSTMinted",
        block_timestamp: isoIn(3000),
        attributes: { owner: cirrusAddress(strato), amount: WEI(5) },
      },
    ]);

    const [data, snap] = [await breakdown(), await snapshot()];
    assert.equal(data.actions.total - base.actions.total, 3);
    assert.equal(data.actions.total, snap.actions.value, "the section total is the tile");

    const categoryCount = (name: string, source: any): number =>
      source.actions.byCategory.find((g: any) => g.category === name)?.count ?? 0;
    assert.equal(categoryCount("swap", data) - categoryCount("swap", base), 2);
    assert.equal(categoryCount("cdp_borrow", data) - categoryCount("cdp_borrow", base), 1);
    // byCategory must account for every listed action, busiest type first
    assert.equal(
      data.actions.byCategory.reduce((total: number, group: any) => total + group.count, 0),
      data.actions.total
    );
    const counts = data.actions.byCategory.map((group: any) => group.count);
    assert.deepEqual(counts, [...counts].sort((a: number, b: number) => b - a));

    const swapGroup = data.actions.byCategory.find((g: any) => g.category === "swap");
    assert.ok(swapGroup.wallets >= 1 && swapGroup.links >= 1);

    const rows = data.actions.rows.filter((row: any) => row.link?.id === link.id);
    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows.map((row: any) => row.category),
      ["cdp_borrow", "swap", "swap"],
      "rows are newest first"
    );
    assert.equal(rows[0].description, "CDPEngine: USDSTMinted");
    assert.equal(rows[0].address, cirrusAddress(strato));
  });

  it("covers today only: yesterday's rows stay out of every section", async () => {
    const link = await createLink({ label: "Breakdown yesterday" });
    const backdated = new Date(Date.now() - DAY_MS - 60_000);
    const sessionId = crypto.randomUUID();
    await sql(
      `INSERT INTO tracking_sessions (id, link_id, opened_at, user_agent, is_bot_or_preview)
       VALUES ($1, $2, $3, 'backdated-breakdown-test', FALSE)`,
      [sessionId, link.id, backdated]
    );
    const strato = randomAddress();
    await sql(
      `INSERT INTO wallet_connections (session_id, link_id, external_wallet_address, strato_address, connector, connected_at)
       VALUES ($1, $2, '', $3, 'Backdated', $4)`,
      [sessionId, link.id, cirrusAddress(strato), backdated]
    );
    await seedCirrus(EVENTS, [
      {
        id: 9920,
        address: "pool000000000000000000000000000000009920",
        contract_name: "Pool",
        event_name: "Swap",
        block_timestamp: new Date(backdated.getTime() + 1000).toISOString(),
        attributes: { sender: cirrusAddress(strato), amountIn: WEI(1) },
      },
    ]);

    const data = await breakdown();
    assert.equal(
      data.opens.rows.filter((row: any) => row.link?.id === link.id).length,
      0,
      "yesterday's open must not be listed"
    );
    assert.equal(
      data.wallets.rows.filter((row: any) => row.address === cirrusAddress(strato)).length,
      0,
      "yesterday's wallet must not be listed"
    );
    assert.equal(
      data.actions.rows.filter((row: any) => row.link?.id === link.id).length,
      0,
      "yesterday's action must not be listed"
    );
  });

  it("agrees with the tiles it drills into", async () => {
    const [data, snap] = [await breakdown(), await snapshot()];
    assert.equal(data.opens.total, snap.opens.value);
    assert.equal(data.wallets.total, snap.wallets.value);
    assert.equal(data.bridgeIns.total, snap.bridgeIns);
    assert.equal(data.actions.total, snap.actions.value);
    assert.equal(data.date, snap.date);
  });
});
