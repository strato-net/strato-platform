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
  resetEtherscan,
  seedCirrus,
  seedEtherscan,
  token,
  waitForReady,
} from "./helpers";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const DEPOSITS = "BlockApps-MercataBridge-DepositCompleted";
const TOKENS = "BlockApps-Token";
const PRICES = "BlockApps-PriceOracle-prices";
const EVENTS = "event";

const WEI = (n: number) => (BigInt(n) * 10n ** 18n).toString();
const secondsAgo = (s: number) => String(Math.floor(Date.now() / 1000) - s);

interface TimelineItem {
  kind: string;
  at: string;
  title: string;
  detail: string | null;
  category: string | null;
  address: string | null;
  linkId: string | null;
  linkLabel: string | null;
  txHash: string | null;
  chainId: number | null;
  chainName: string | null;
  externalTxHash: string | null;
  externalTxUrl: string | null;
  amount: string | null;
  amountUsd: number | null;
  attributedLinkId: string | null;
}

interface Timeline {
  address: string;
  addresses: string[];
  externalWalletAddress: string | null;
  stratoAddress: string | null;
  connector: string | null;
  firstSeenAt: string;
  lastActivityAt: string | null;
  links: { id: string; label: string }[];
  activitySummary: Record<string, number>;
  remoteChainEnabled: boolean;
  items: TimelineItem[];
}

const timelineOf = async (address: string): Promise<Timeline> => {
  const res = await authed(`/tracking-api/users/${address}/timeline`);
  assert.equal(res.status, 200, `timeline for ${address}: ${res.status}`);
  return (await res.json()) as Timeline;
};

const kinds = (timeline: Timeline, kind: string): TimelineItem[] =>
  timeline.items.filter((item) => item.kind === kind);

describe("user activity timeline", () => {
  before(async () => {
    await waitForReady();
    await resetCirrus();
    await resetEtherscan();
  });
  after(async () => {
    await resetCirrus();
    await resetEtherscan();
    await db.end();
  });

  it("merges link opens, engagement, wallet connections, chain activity and origin-chain transactions", async () => {
    const link = await createLink({ label: "Timeline story", source: "LinkedIn" });
    const { cookie } = await openLink(link.slug);
    await sleep(200);
    const external = randomAddress();
    const strato = randomAddress();
    const asset = cirrusAddress(randomAddress());
    await api("/tracking-api/wallet-connected", {
      method: "POST",
      cookie,
      body: { externalWalletAddress: external, stratoAddress: strato, connector: "MetaMask" },
    });
    await api("/tracking-api/engage", { method: "POST", cookie });

    await seedCirrus(DEPOSITS, [
      {
        id: 9101,
        externalChainId: 1,
        externalSender: cirrusAddress(external),
        externalTxHash: "0xbridgetx9101",
        stratoRecipient: cirrusAddress(strato),
        stratoToken: asset,
        stratoTokenAmount: WEI(3),
        block_timestamp: isoIn(1000),
        transaction_hash: "strato9101",
      },
    ]);
    await seedCirrus(TOKENS, [{ address: asset, _symbol: "WETH" }]);
    await seedCirrus(PRICES, [{ key: asset, value: WEI(2000) }]);
    await seedCirrus(EVENTS, [
      {
        id: 9501,
        address: "pool000000000000000000000000000000000009",
        contract_name: "Pool",
        event_name: "Swap",
        block_timestamp: isoIn(2000),
        attributes: { sender: cirrusAddress(strato), amountIn: WEI(1) },
      },
    ]);
    // Origin chain: the funding transfer that preceded the bridge, plus the
    // bridge deposit itself (deduped against the bridge-in item)
    await seedEtherscan(1, external, [
      {
        hash: "0xfunding9101",
        from: "0x00000000000000000000000000000000000000f1",
        to: `0x${cirrusAddress(external)}`,
        value: WEI(4),
        timeStamp: secondsAgo(7200),
        isError: "0",
        functionName: "",
      },
      {
        hash: "0xbridgetx9101",
        from: `0x${cirrusAddress(external)}`,
        to: "0x00000000000000000000000000000000000000b1",
        value: WEI(3),
        timeStamp: secondsAgo(3600),
        isError: "0",
        functionName: "deposit(address,uint256)",
      },
    ]);

    const timeline = await timelineOf(cirrusAddress(external));

    assert.equal(timeline.address, cirrusAddress(external));
    assert.deepEqual(
      new Set(timeline.addresses),
      new Set([cirrusAddress(external), cirrusAddress(strato)])
    );
    assert.equal(timeline.externalWalletAddress, cirrusAddress(external));
    assert.equal(timeline.stratoAddress, cirrusAddress(strato));
    assert.equal(timeline.connector, "MetaMask");
    assert.equal(timeline.remoteChainEnabled, true);
    assert.deepEqual(timeline.activitySummary, { bridge_in: 1, swap: 1 });
    assert.deepEqual(
      timeline.links.map((l) => l.id),
      [link.id]
    );

    // Newest first, and every expected kind is present exactly once
    const timestamps = timeline.items.map((item) => Date.parse(item.at));
    assert.deepEqual(timestamps, [...timestamps].sort((a, b) => b - a), "items are newest first");
    assert.equal(kinds(timeline, "link_opened").length, 1);
    assert.equal(kinds(timeline, "engaged").length, 1);
    assert.equal(kinds(timeline, "wallet_connected").length, 1);
    assert.equal(kinds(timeline, "bridge_in").length, 1);
    assert.equal(kinds(timeline, "onchain").length, 1);

    const opened = kinds(timeline, "link_opened")[0];
    assert.equal(opened.linkId, link.id);
    assert.equal(opened.linkLabel, "Timeline story");

    const connected = kinds(timeline, "wallet_connected")[0];
    assert.equal(connected.address, cirrusAddress(external));
    assert.match(connected.detail ?? "", /MetaMask/);

    const bridge = kinds(timeline, "bridge_in")[0];
    assert.equal(bridge.category, "bridge_in");
    assert.equal(bridge.amount, "3");
    assert.equal(bridge.amountUsd, 6000);
    assert.equal(bridge.txHash, "strato9101");
    assert.equal(bridge.chainId, 1);
    assert.equal(bridge.chainName, "Ethereum");
    assert.equal(bridge.externalTxHash, "0xbridgetx9101");
    assert.equal(bridge.externalTxUrl, "https://etherscan.io/tx/0xbridgetx9101");
    assert.equal(bridge.attributedLinkId, link.id, "bridge-in is attributed to the link");

    const swap = kinds(timeline, "onchain")[0];
    assert.equal(swap.category, "swap");
    assert.equal(swap.title, "Pool: Swap");
    assert.equal(swap.attributedLinkId, link.id);

    // Origin chain: the funding transfer only — the bridge deposit hash is
    // already represented by the bridge-in item
    const remote = kinds(timeline, "remote_chain");
    assert.equal(remote.length, 1);
    assert.equal(remote[0].externalTxHash, "0xfunding9101");
    assert.equal(remote[0].chainName, "Ethereum");
    assert.equal(remote[0].externalTxUrl, "https://etherscan.io/tx/0xfunding9101");
    assert.equal(remote[0].amount, "4");
    assert.match(remote[0].title, /Received 4 ETH on Ethereum/);
    assert.equal(
      remote[0].at,
      timeline.items[timeline.items.length - 1].at,
      "the origin-chain transfer is the oldest item"
    );

    // Reachable by the STRATO address too — same person, same story
    const byStrato = await timelineOf(cirrusAddress(strato));
    assert.equal(byStrato.items.length, timeline.items.length);
    assert.deepEqual(new Set(byStrato.addresses), new Set(timeline.addresses));
  });

  it("merges every link the wallet touched, following the external/STRATO identity", async () => {
    const external = randomAddress();
    const strato = randomAddress();
    const first = await createLink({ label: "Timeline link A" });
    const second = await createLink({ label: "Timeline link B" });

    const a = await openLink(first.slug);
    await sleep(200);
    await api("/tracking-api/wallet-connected", {
      method: "POST",
      cookie: a.cookie,
      body: { externalWalletAddress: external, stratoAddress: strato, connector: "MetaMask" },
    });
    const b = await openLink(second.slug);
    await sleep(200);
    // Second visit knows only the STRATO account: the timeline must still
    // find it when the external address is the one being viewed
    await api("/tracking-api/wallet-connected", {
      method: "POST",
      cookie: b.cookie,
      body: { stratoAddress: strato },
    });

    const timeline = await timelineOf(cirrusAddress(external));
    assert.deepEqual(
      new Set(timeline.links.map((l) => l.id)),
      new Set([first.id, second.id])
    );
    assert.equal(kinds(timeline, "link_opened").length, 2);
    assert.equal(kinds(timeline, "wallet_connected").length, 2);
    assert.equal(kinds(timeline, "engaged").length, 0, "no engage beacon was sent");
    assert.deepEqual(timeline.activitySummary, {});
    assert.equal(kinds(timeline, "remote_chain").length, 0, "no bridge-in, no origin chain");
  });

  it("rejects unauthorized callers and unknown or malformed addresses", async () => {
    const unknown = cirrusAddress(randomAddress());
    assert.equal((await api(`/tracking-api/users/${unknown}/timeline`)).status, 401);
    assert.equal(
      (
        await api(`/tracking-api/users/${unknown}/timeline`, {
          auth: await token("stranger@example.com"),
        })
      ).status,
      403
    );
    assert.equal((await authed(`/tracking-api/users/${unknown}/timeline`)).status, 404);
    assert.equal((await authed("/tracking-api/users/not-an-address/timeline")).status, 400);
  });
});
