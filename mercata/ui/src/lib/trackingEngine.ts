// Client-side attribution engine for the tracking dashboard. Joins the
// offchain snapshot (tracking service) with chain activity (mercata backend).
// Attribution rule: the most recent non-bot tracked wallet connection before a
// chain event, within the attribution window, wins; ties break to the
// earliest-created connection. Assignment is computed once over ALL links'
// connections, so one chain event is never counted under two links.

import {
  TrackingActivityItem,
  TrackingActivityResponse,
  TrackingActivitySummary,
  TrackingBridgeIn,
  TrackingChainBridgeIn,
  TrackingChainEvent,
  TrackingLinkDetail,
  TrackingLinkSummary,
  TrackingSnapshot,
  TrackingSnapshotConnection,
  TrackingWalletDetail,
  TrackingWalletSummary,
} from './trackingApi';

export const ATTRIBUTION_WINDOW_DAYS = 90;

// All addresses the dashboard needs chain activity for, in a stable order
// (used as a query key, so determinism matters).
export const collectTrackedAddresses = (snapshot: TrackingSnapshot): string[] => {
  const addresses = new Set<string>();
  for (const conn of snapshot.connections) {
    if (conn.isBotOrPreview) continue;
    if (conn.externalWalletAddress) addresses.add(conn.externalWalletAddress);
    if (conn.stratoAddress) addresses.add(conn.stratoAddress);
  }
  return [...addresses].sort();
};

interface Attribution {
  linkId: string;
  connectionId: string;
}

interface WalletIdentity {
  address: string;
  externalWalletAddress: string | null;
  stratoAddress: string | null;
  connector: string | null;
  connectedAt: string;
  addresses: Set<string>;
}

// External-address-first identity key, so a visitor whose MetaMask connect
// precedes their STRATO login counts as one wallet
const walletKeyOf = (conn: TrackingSnapshotConnection): string =>
  conn.externalWalletAddress || conn.stratoAddress || '';

const addressesOf = (conn: TrackingSnapshotConnection): string[] =>
  [conn.externalWalletAddress, conn.stratoAddress].filter((a): a is string => !!a);

const countByCategory = (
  events: TrackingChainEvent[],
  bridgeInCount: number
): TrackingActivitySummary => {
  const summary: TrackingActivitySummary = {};
  if (bridgeInCount > 0) summary.bridge_in = bridgeInCount;
  for (const event of events) {
    summary[event.category] = (summary[event.category] ?? 0) + 1;
  }
  return summary;
};

const toBridgeInItem = (b: TrackingChainBridgeIn): TrackingBridgeIn => ({
  address: b.stratoRecipient || b.externalSender,
  asset: b.asset,
  amount: b.amount,
  amountUsd: b.amountUsd,
  txHash: b.txHash,
  at: b.at,
});

const toActivityItem = (e: TrackingChainEvent): TrackingActivityItem => ({
  category: e.category,
  description: `${e.contractName}: ${e.eventName}`,
  address: e.address,
  txHash: null,
  at: e.at,
});

export class TrackingComputed {
  private assignments = new Map<string, Attribution>();
  private identitiesByLink = new Map<string, WalletIdentity[]>();

  constructor(
    private snapshot: TrackingSnapshot,
    private activity: TrackingActivityResponse
  ) {
    this.computeAssignments();
    this.computeIdentities();
  }

  private computeAssignments(): void {
    const byAddress = new Map<string, TrackingSnapshotConnection[]>();
    for (const conn of this.snapshot.connections) {
      if (conn.isBotOrPreview) continue;
      for (const addr of addressesOf(conn)) {
        const list = byAddress.get(addr);
        if (list) list.push(conn);
        else byAddress.set(addr, [conn]);
      }
    }
    for (const list of byAddress.values()) {
      list.sort((a, b) => Date.parse(a.connectedAt) - Date.parse(b.connectedAt));
    }

    const windowMs = ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const facts: { eventKey: string; addresses: string[]; timestampMs: number }[] = [
      ...this.activity.bridgeIns.map((b) => ({
        eventKey: b.eventKey,
        addresses: [b.stratoRecipient, b.externalSender].filter(Boolean),
        timestampMs: Date.parse(b.at),
      })),
      ...this.activity.events.map((e) => ({
        eventKey: e.eventKey,
        addresses: [e.address].filter(Boolean),
        timestampMs: Date.parse(e.at),
      })),
    ];

    for (const fact of facts) {
      if (!Number.isFinite(fact.timestampMs)) continue;
      let winner: TrackingSnapshotConnection | null = null;
      let winnerMs = 0;
      for (const addr of fact.addresses) {
        for (const conn of byAddress.get(addr) ?? []) {
          const connectedMs = Date.parse(conn.connectedAt);
          if (connectedMs > fact.timestampMs) break; // sorted ascending
          if (fact.timestampMs - connectedMs > windowMs) continue;
          if (
            !winner ||
            connectedMs > winnerMs ||
            (connectedMs === winnerMs && Number(conn.id) < Number(winner.id))
          ) {
            winner = conn;
            winnerMs = connectedMs;
          }
        }
      }
      if (winner) {
        this.assignments.set(fact.eventKey, { linkId: winner.linkId, connectionId: winner.id });
      }
    }
  }

  private computeIdentities(): void {
    for (const conn of this.snapshot.connections) {
      if (conn.isBotOrPreview) continue;
      const key = walletKeyOf(conn);
      if (!key) continue;
      let identities = this.identitiesByLink.get(conn.linkId);
      if (!identities) {
        identities = [];
        this.identitiesByLink.set(conn.linkId, identities);
      }
      let identity = identities.find((candidate) => candidate.address === key);
      if (!identity) {
        identity = {
          address: key,
          externalWalletAddress: null,
          stratoAddress: null,
          connector: null,
          connectedAt: conn.connectedAt,
          addresses: new Set(),
        };
        identities.push(identity);
      }
      if (conn.externalWalletAddress) {
        identity.externalWalletAddress = conn.externalWalletAddress;
        identity.addresses.add(conn.externalWalletAddress);
      }
      if (conn.stratoAddress) {
        identity.stratoAddress = conn.stratoAddress;
        identity.addresses.add(conn.stratoAddress);
      }
      identity.connector = identity.connector ?? conn.connector;
      if (conn.connectedAt < identity.connectedAt) identity.connectedAt = conn.connectedAt;
    }
  }

  private attributedBridgeIns(linkId: string): TrackingChainBridgeIn[] {
    return this.activity.bridgeIns.filter(
      (b) => this.assignments.get(b.eventKey)?.linkId === linkId
    );
  }

  private attributedEvents(linkId: string): TrackingChainEvent[] {
    return this.activity.events.filter(
      (e) => this.assignments.get(e.eventKey)?.linkId === linkId
    );
  }

  private fullActivityFor(addresses: Set<string>) {
    const events = this.activity.events.filter((e) => addresses.has(e.address));
    const bridgeIns = this.activity.bridgeIns.filter(
      (b) => addresses.has(b.stratoRecipient) || addresses.has(b.externalSender)
    );
    return { events, bridgeIns };
  }

  // Counts over the wallet's FULL history (a prospect's pre-link activity is
  // sales signal); link-level metrics stay attribution-filtered.
  private summarizeWallet(identity: WalletIdentity): TrackingWalletSummary {
    const { events, bridgeIns } = this.fullActivityFor(identity.addresses);
    const timestamps = [
      ...events.map((e) => Date.parse(e.at)),
      ...bridgeIns.map((b) => Date.parse(b.at)),
    ].filter(Number.isFinite);
    return {
      address: identity.address,
      externalWalletAddress: identity.externalWalletAddress,
      stratoAddress: identity.stratoAddress,
      connector: identity.connector,
      connectedAt: identity.connectedAt,
      activitySummary: countByCategory(events, bridgeIns.length),
      lastActivityAt: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null,
    };
  }

  summarizeLink(linkId: string): TrackingLinkSummary | null {
    const link = this.snapshot.links.find((l) => l.id === linkId);
    if (!link) return null;
    const stats = this.snapshot.sessionStats.find((s) => s.linkId === linkId);
    const identities = this.identitiesByLink.get(linkId) ?? [];
    const bridgeIns = this.attributedBridgeIns(linkId);
    const events = this.attributedEvents(linkId);

    const bridgedWallets = new Set(bridgeIns.map((b) => b.stratoRecipient || b.externalSender));

    let bridgeValueUsd: number | null = 0;
    for (const bridge of bridgeIns) {
      if (bridge.amountUsd == null) {
        bridgeValueUsd = null; // unpriced token: show "unknown", not a wrong total
        break;
      }
      bridgeValueUsd += bridge.amountUsd;
    }
    if (bridgeIns.length === 0) bridgeValueUsd = 0;

    // Activated = bridged and then performed a meaningful action afterwards
    const firstBridgeByWallet = new Map<string, number>();
    for (const bridge of bridgeIns) {
      if (!bridge.stratoRecipient) continue;
      const ms = Date.parse(bridge.at);
      const prev = firstBridgeByWallet.get(bridge.stratoRecipient);
      if (prev == null || ms < prev) firstBridgeByWallet.set(bridge.stratoRecipient, ms);
    }
    const activatedWallets = new Set<string>();
    for (const event of events) {
      const firstBridge = firstBridgeByWallet.get(event.address);
      if (firstBridge != null && Date.parse(event.at) > firstBridge) {
        activatedWallets.add(event.address);
      }
    }

    const timestamps = [
      ...(stats?.lastOpenedAt ? [Date.parse(stats.lastOpenedAt)] : []),
      ...identities.map((i) => Date.parse(i.connectedAt)),
      ...bridgeIns.map((b) => Date.parse(b.at)),
      ...events.map((e) => Date.parse(e.at)),
    ].filter(Number.isFinite);

    return {
      id: link.id,
      slug: link.slug,
      url: link.url,
      label: link.label,
      source: link.source ?? '',
      destination: link.destination,
      creator: link.createdBy,
      active: link.active,
      opens: stats?.opens ?? 0,
      wallets: identities.length,
      bridgedWallets: bridgedWallets.size,
      bridgeValueUsd,
      activatedWallets: activatedWallets.size,
      lastActivityAt: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null,
    };
  }

  linkSummaries(): TrackingLinkSummary[] {
    return this.snapshot.links
      .map((link) => this.summarizeLink(link.id))
      .filter((s): s is TrackingLinkSummary => s !== null);
  }

  linkDetail(linkId: string): TrackingLinkDetail | null {
    const summary = this.summarizeLink(linkId);
    if (!summary) return null;
    const bridgeIns = this.attributedBridgeIns(linkId).sort(
      (a, b) => Date.parse(b.at) - Date.parse(a.at)
    );
    const events = this.attributedEvents(linkId).sort(
      (a, b) => Date.parse(b.at) - Date.parse(a.at)
    );
    const walletSummaries = (this.identitiesByLink.get(linkId) ?? [])
      .map((identity) => this.summarizeWallet(identity))
      .sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''));

    return {
      ...summary,
      bridgeIns: bridgeIns.map(toBridgeInItem),
      activity: events.map(toActivityItem),
      activitySummary: countByCategory(events, bridgeIns.length),
      walletSummaries,
      geoPoints: this.snapshot.geoPoints
        .filter((point) => point.linkId === linkId)
        .map(({ linkId: _linkId, ...point }) => point),
    };
  }

  walletDetail(linkId: string, address: string): TrackingWalletDetail | null {
    const identity = (this.identitiesByLink.get(linkId) ?? []).find(
      (candidate) => candidate.address === address || candidate.addresses.has(address)
    );
    if (!identity) return null;
    const { events, bridgeIns } = this.fullActivityFor(identity.addresses);
    return {
      address: identity.address,
      addresses: [...identity.addresses],
      externalWalletAddress: identity.externalWalletAddress,
      stratoAddress: identity.stratoAddress,
      connector: identity.connector,
      connectedAt: identity.connectedAt,
      activitySummary: countByCategory(events, bridgeIns.length),
      bridgeIns: bridgeIns
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
        .map(toBridgeInItem),
      activity: events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).map(toActivityItem),
    };
  }
}

export const computeTracking = (
  snapshot: TrackingSnapshot,
  activity: TrackingActivityResponse
): TrackingComputed => new TrackingComputed(snapshot, activity);
