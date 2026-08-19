import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  api,
  authed,
  cirrusAddress,
  createLink,
  db,
  isoIn,
  openLink,
  randomAddress,
  resetCirrus,
  seedCirrus,
  waitForReady,
} from "./helpers";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Cirrus tables the service reads (see src/services/cirrusService.ts)
const DEPOSITS = "BlockApps-MercataBridge-DepositCompleted";
const TOKENS = "BlockApps-Token";
const PRICES = "BlockApps-PriceOracle-prices";
const EVENTS = "event";

const WEI = (n: number) => (BigInt(n) * 10n ** 18n).toString();

describe("Cirrus attribution joins", () => {
  before(async () => {
    await waitForReady();
    await resetCirrus();
  });
  after(async () => {
    await resetCirrus();
    await db.end();
  });

  it("attributes bridge-ins and post-bridge activity to the link whose wallet connected", async () => {
    const link = await createLink({ label: "Attributed" });
    const { cookie } = await openLink(link.slug);
    await sleep(200);
    const external = randomAddress();
    const strato = randomAddress();
    const token = cirrusAddress(randomAddress());
    await api("/tracking-api/wallet-connected", {
      method: "POST",
      cookie,
      body: { externalWalletAddress: external, stratoAddress: strato, connector: "MetaMask" },
    });
    await api("/tracking-api/engage", { method: "POST", cookie });

    // Chain events land after the connection: a 2 WETH bridge-in at $3000
    // and a swap by the STRATO recipient afterwards.
    await seedCirrus(DEPOSITS, [
      {
        id: 101,
        externalChainId: 1,
        externalSender: cirrusAddress(external),
        externalTxHash: "0xext101",
        stratoRecipient: cirrusAddress(strato),
        stratoToken: token,
        stratoTokenAmount: WEI(2),
        block_timestamp: isoIn(1000),
        transaction_hash: "strato101",
      },
    ]);
    await seedCirrus(TOKENS, [{ address: token, _symbol: "WETH" }]);
    await seedCirrus(PRICES, [{ key: token, value: WEI(3000) }]);
    await seedCirrus(EVENTS, [
      {
        id: 5001,
        address: "pool000000000000000000000000000000000001",
        contract_name: "Pool",
        event_name: "Swap",
        block_timestamp: isoIn(2000),
        attributes: { sender: cirrusAddress(strato), amountIn: WEI(1) },
      },
      // Somebody else's swap: must not be attributed anywhere
      {
        id: 5002,
        address: "pool000000000000000000000000000000000001",
        contract_name: "Pool",
        event_name: "Swap",
        block_timestamp: isoIn(2000),
        attributes: { sender: cirrusAddress(randomAddress()), amountIn: WEI(1) },
      },
    ]);

    const list = (await (await authed("/tracking-api/links")).json()) as any[];
    const summary = list.find((l) => l.id === link.id);
    assert.equal(summary.opens, 1);
    assert.equal(summary.engagedOpens, 1);
    assert.equal(summary.wallets, 1);
    assert.equal(summary.bridgedWallets, 1);
    assert.equal(summary.bridgeValueUsd, 6000);
    assert.equal(summary.activatedWallets, 1, "swap after bridge-in activates the wallet");

    const detail = (await (await authed(`/tracking-api/links/${link.id}`)).json()) as any;
    assert.equal(detail.bridgeIns.length, 1);
    const bridgeIn = detail.bridgeIns[0];
    assert.equal(bridgeIn.address, cirrusAddress(strato));
    assert.equal(bridgeIn.asset, "WETH");
    assert.equal(bridgeIn.amount, "2");
    assert.equal(bridgeIn.amountUsd, 6000);
    assert.equal(bridgeIn.txHash, "strato101");
    assert.equal(bridgeIn.externalChainId, 1);
    assert.equal(bridgeIn.externalTxHash, "0xext101");
    assert.deepEqual(detail.activitySummary, { bridge_in: 1, swap: 1 });
    assert.equal(detail.activity.length, 1);
    assert.equal(detail.activity[0].category, "swap");
    assert.equal(detail.activity[0].description, "Pool: Swap");
    assert.equal(detail.activity[0].address, cirrusAddress(strato));

    assert.equal(detail.walletSummaries.length, 1);
    const wallet = detail.walletSummaries[0];
    assert.equal(wallet.address, cirrusAddress(external), "external address is the identity key");
    assert.equal(wallet.stratoAddress, cirrusAddress(strato));
    assert.equal(wallet.connector, "MetaMask");
    assert.deepEqual(wallet.activitySummary, { bridge_in: 1, swap: 1 });

    const drill = await authed(`/tracking-api/links/${link.id}/wallets/${cirrusAddress(external)}`);
    assert.equal(drill.status, 200);
    const walletDetail = (await drill.json()) as any;
    assert.deepEqual(new Set(walletDetail.addresses), new Set([cirrusAddress(external), cirrusAddress(strato)]));
    assert.equal(walletDetail.bridgeIns.length, 1);
    assert.equal(walletDetail.activity.length, 1);
    // Drill-down is reachable by either identifier
    assert.equal((await authed(`/tracking-api/links/${link.id}/wallets/${cirrusAddress(strato)}`)).status, 200);
  });

  it("does not attribute chain events that predate the connection, and reports unknown value for unpriced tokens", async () => {
    const link = await createLink({ label: "Unpriced" });
    const { cookie } = await openLink(link.slug);
    await sleep(200);
    const strato = randomAddress();
    const unpricedToken = cirrusAddress(randomAddress());
    await api("/tracking-api/wallet-connected", { method: "POST", cookie, body: { stratoAddress: strato } });

    await seedCirrus(DEPOSITS, [
      {
        id: 201,
        externalChainId: 8453,
        externalSender: cirrusAddress(randomAddress()),
        externalTxHash: "0xold",
        stratoRecipient: cirrusAddress(strato),
        stratoToken: unpricedToken,
        stratoTokenAmount: WEI(5),
        block_timestamp: isoIn(-7 * 24 * 3600 * 1000), // a week before the connection
        transaction_hash: "old201",
      },
      {
        id: 202,
        externalChainId: 8453,
        externalSender: cirrusAddress(randomAddress()),
        externalTxHash: "0xnew",
        stratoRecipient: cirrusAddress(strato),
        stratoToken: unpricedToken,
        stratoTokenAmount: WEI(5),
        block_timestamp: isoIn(1000),
        transaction_hash: "new202",
      },
    ]);

    const detail = (await (await authed(`/tracking-api/links/${link.id}`)).json()) as any;
    assert.equal(detail.bridgeIns.length, 1, "only the post-connection bridge-in is attributed");
    assert.equal(detail.bridgeIns[0].txHash, "new202");
    assert.equal(detail.bridgeIns[0].amountUsd, null);
    assert.equal(detail.bridgeValueUsd, null, "unpriced token => unknown, not zero");
    assert.equal(detail.bridgeIns[0].asset, unpricedToken.slice(0, 8), "no symbol => address prefix");

    // The wallet drill-down deliberately shows the FULL history
    const drill = (await (await authed(`/tracking-api/links/${link.id}/wallets/${cirrusAddress(strato)}`)).json()) as any;
    assert.equal(drill.bridgeIns.length, 2);
  });

  it("assigns an event to the most recent connection so two links never share it", async () => {
    const strato = randomAddress();
    const first = await createLink({ label: "First touch" });
    const second = await createLink({ label: "Most recent touch" });
    const a = await openLink(first.slug);
    await sleep(200);
    await api("/tracking-api/wallet-connected", { method: "POST", cookie: a.cookie, body: { stratoAddress: strato } });
    await sleep(1100); // connected_at ordering must be unambiguous
    const b = await openLink(second.slug);
    await sleep(200);
    await api("/tracking-api/wallet-connected", { method: "POST", cookie: b.cookie, body: { stratoAddress: strato } });

    await seedCirrus(EVENTS, [
      {
        id: 6001,
        address: "cdp0000000000000000000000000000000000001",
        contract_name: "CDPEngine",
        event_name: "USDSTMinted",
        block_timestamp: isoIn(1000),
        attributes: { owner: cirrusAddress(strato), amount: WEI(10) },
      },
    ]);

    const firstDetail = (await (await authed(`/tracking-api/links/${first.id}`)).json()) as any;
    const secondDetail = (await (await authed(`/tracking-api/links/${second.id}`)).json()) as any;
    assert.deepEqual(firstDetail.activitySummary, {});
    assert.deepEqual(secondDetail.activitySummary, { cdp_borrow: 1 });
    // ...but both links count the wallet as connected
    assert.equal(firstDetail.wallets, 1);
    assert.equal(secondDetail.wallets, 1);
  });
});
