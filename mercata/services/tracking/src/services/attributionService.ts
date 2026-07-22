import { config } from "../config";
import { query } from "../db/pool";
import { listLinks, publicUrlForSlug, TrackingLink } from "./linkService";
import {
  ActivityEvent,
  BridgeInEvent,
  fetchActivityEvents,
  fetchBridgeIns,
  fetchOraclePricesUsd,
  fetchTokenSymbols,
} from "./cirrusService";

interface ConnectionRow {
  id: string;
  session_id: string;
  link_id: string;
  external_wallet_address: string;
  strato_address: string;
  connector: string | null;
  connected_at: Date;
  is_bot_or_preview: boolean;
}

interface SessionAgg {
  link_id: string;
  opens: string;
  engaged_opens: string;
  bot_opens: string;
  last_opened_at: Date | null;
}

interface Attribution {
  linkId: string;
  connectionId: string;
}

export interface LinkSummary {
  id: string;
  slug: string;
  url: string;
  label: string;
  source: string;
  destination: string;
  creator: string;
  active: boolean;
  createdAt: string;
  opens: number;
  engagedOpens: number;
  botOpens: number;
  wallets: number;
  bridgedWallets: number;
  bridgeValueUsd: number | null;
  activatedWallets: number;
  lastActivityAt: string | null;
}

export interface LinkDetail extends LinkSummary {
  connections: {
    externalWalletAddress: string | null;
    stratoAddress: string | null;
    connector: string | null;
    connectedAt: string;
  }[];
  bridgeIns: {
    address: string;
    asset: string;
    amount: string;
    amountUsd: number | null;
    txHash: string | null;
    at: string;
  }[];
  activity: {
    kind: "first_action" | "metal_purchase" | "swap" | "other";
    description: string;
    address: string;
    txHash: string | null;
    at: string;
  }[];
}

interface AttributionSnapshot {
  links: TrackingLink[];
  connections: ConnectionRow[];
  sessionAggs: Map<string, SessionAgg>;
  bridgeIns: BridgeInEvent[];
  activityEvents: ActivityEvent[];
  // eventKey -> winning (link, connection); one entry per chain event, ever
  assignments: Map<string, Attribution>;
  tokenSymbols: Map<string, string>;
  oraclePrices: Map<string, number>;
}

let cachedSnapshot: { snapshot: AttributionSnapshot; expiresAt: number } | null = null;

const addressesOf = (conn: ConnectionRow): string[] =>
  [conn.external_wallet_address, conn.strato_address].filter(Boolean);

// Attribution rule: most recent tracked wallet connection before the event,
// within the attribution window, wins; ties break to the earliest-created
// connection. Computed ONCE over the union of all links' connections so a
// chain event can never be counted under two links.
const assignEvents = (
  connections: ConnectionRow[],
  events: { eventKey: string; addresses: string[]; timestampMs: number }[]
): Map<string, Attribution> => {
  const byAddress = new Map<string, ConnectionRow[]>();
  for (const conn of connections) {
    if (conn.is_bot_or_preview) continue;
    for (const addr of addressesOf(conn)) {
      const list = byAddress.get(addr);
      if (list) list.push(conn);
      else byAddress.set(addr, [conn]);
    }
  }
  for (const list of byAddress.values()) {
    list.sort((a, b) => a.connected_at.getTime() - b.connected_at.getTime());
  }

  const windowMs = config.tracking.attributionWindowDays * 24 * 60 * 60 * 1000;
  const assignments = new Map<string, Attribution>();

  for (const event of events) {
    if (!Number.isFinite(event.timestampMs)) continue;
    let winner: ConnectionRow | null = null;
    for (const addr of event.addresses) {
      for (const conn of byAddress.get(addr) ?? []) {
        const connectedMs = conn.connected_at.getTime();
        if (connectedMs > event.timestampMs) break; // sorted ascending
        if (event.timestampMs - connectedMs > windowMs) continue;
        if (
          !winner ||
          connectedMs > winner.connected_at.getTime() ||
          (connectedMs === winner.connected_at.getTime() && Number(conn.id) < Number(winner.id))
        ) {
          winner = conn;
        }
      }
    }
    if (winner) {
      assignments.set(event.eventKey, { linkId: winner.link_id, connectionId: winner.id });
    }
  }
  return assignments;
};

const buildSnapshot = async (): Promise<AttributionSnapshot> => {
  const links = await listLinks();

  const connectionsResult = await query<ConnectionRow>(
    `SELECT wc.*, ts.is_bot_or_preview
     FROM wallet_connections wc
     JOIN tracking_sessions ts ON ts.id = wc.session_id
     ORDER BY wc.connected_at ASC`
  );
  const connections = connectionsResult.rows;

  const sessionAggsResult = await query<SessionAgg>(
    `SELECT link_id,
            COUNT(*) FILTER (WHERE NOT is_bot_or_preview) AS opens,
            COUNT(*) FILTER (WHERE engaged_at IS NOT NULL) AS engaged_opens,
            COUNT(*) FILTER (WHERE is_bot_or_preview) AS bot_opens,
            MAX(opened_at) AS last_opened_at
     FROM tracking_sessions
     GROUP BY link_id`
  );
  const sessionAggs = new Map(sessionAggsResult.rows.map((r) => [String(r.link_id), r]));

  const trackedConnections = connections.filter((c) => !c.is_bot_or_preview);
  const stratoAddresses = [
    ...new Set(trackedConnections.map((c) => c.strato_address).filter(Boolean)),
  ];
  const externalAddresses = [
    ...new Set(trackedConnections.map((c) => c.external_wallet_address).filter(Boolean)),
  ];

  const bridgeIns = await fetchBridgeIns(stratoAddresses, externalAddresses);

  // Post-bridge activity can involve STRATO addresses we only know from the
  // bridge events themselves (external wallet tracked, STRATO recipient not).
  const activityAddresses = [
    ...new Set([...stratoAddresses, ...bridgeIns.map((b) => b.stratoRecipient).filter(Boolean)]),
  ];
  const activityEvents = await fetchActivityEvents(activityAddresses);

  const assignments = assignEvents(connections, [
    ...bridgeIns.map((b) => ({
      eventKey: b.eventKey,
      addresses: [b.stratoRecipient, b.externalSender].filter(Boolean),
      timestampMs: b.timestampMs,
    })),
    ...activityEvents.map((e) => ({
      eventKey: e.eventKey,
      addresses: [e.userAddress].filter(Boolean),
      timestampMs: e.timestampMs,
    })),
  ]);

  const tokenAddresses = [...new Set(bridgeIns.map((b) => b.stratoToken).filter(Boolean))];
  const [tokenSymbols, oraclePrices] = await Promise.all([
    fetchTokenSymbols(tokenAddresses),
    tokenAddresses.length ? fetchOraclePricesUsd() : Promise.resolve(new Map<string, number>()),
  ]);

  return {
    links,
    connections,
    sessionAggs,
    bridgeIns,
    activityEvents,
    assignments,
    tokenSymbols,
    oraclePrices,
  };
};

export const getSnapshot = async (): Promise<AttributionSnapshot> => {
  if (cachedSnapshot && cachedSnapshot.expiresAt > Date.now()) {
    return cachedSnapshot.snapshot;
  }
  const snapshot = await buildSnapshot();
  cachedSnapshot = {
    snapshot,
    expiresAt: Date.now() + config.tracking.cacheTtlSeconds * 1000,
  };
  return snapshot;
};

export const invalidateSnapshot = (): void => {
  cachedSnapshot = null;
};

const tokenAmount = (raw: string): number => {
  try {
    return Number(BigInt(raw)) / 1e18;
  } catch {
    return 0;
  }
};

// Identity key for counting distinct wallets. External-address-first so a
// visitor whose MetaMask connect precedes their STRATO login (two rows: one
// ext-only, one ext+strato) counts as one wallet, not two.
const walletKeyOf = (conn: ConnectionRow): string =>
  conn.external_wallet_address || conn.strato_address;

const summarizeLink = (snapshot: AttributionSnapshot, link: TrackingLink): LinkSummary => {
  const linkId = String(link.id);
  const agg = snapshot.sessionAggs.get(linkId);

  const linkConnections = snapshot.connections.filter(
    (c) => String(c.link_id) === linkId && !c.is_bot_or_preview
  );
  const wallets = new Set(linkConnections.map(walletKeyOf));

  const attributedBridgeIns = snapshot.bridgeIns.filter(
    (b) => snapshot.assignments.get(b.eventKey)?.linkId === link.id
  );
  const attributedActivity = snapshot.activityEvents.filter(
    (e) => snapshot.assignments.get(e.eventKey)?.linkId === link.id
  );

  const bridgedWallets = new Set(
    attributedBridgeIns.map((b) => b.stratoRecipient || b.externalSender)
  );

  let bridgeValueUsd: number | null = 0;
  for (const bridge of attributedBridgeIns) {
    const price = snapshot.oraclePrices.get(bridge.stratoToken);
    if (price == null) {
      bridgeValueUsd = null; // unpriced token: show "unknown" not a wrong total
      break;
    }
    bridgeValueUsd += tokenAmount(bridge.stratoTokenAmount) * price;
  }
  if (attributedBridgeIns.length === 0) bridgeValueUsd = 0;

  // Activated = bridged and then performed a meaningful action afterwards
  const firstBridgeByWallet = new Map<string, number>();
  for (const bridge of attributedBridgeIns) {
    const key = bridge.stratoRecipient;
    if (!key) continue;
    const prev = firstBridgeByWallet.get(key);
    if (prev == null || bridge.timestampMs < prev) firstBridgeByWallet.set(key, bridge.timestampMs);
  }
  const activatedWallets = new Set<string>();
  for (const event of attributedActivity) {
    const firstBridge = firstBridgeByWallet.get(event.userAddress);
    if (firstBridge != null && event.timestampMs > firstBridge) {
      activatedWallets.add(event.userAddress);
    }
  }

  const timestamps: number[] = [
    ...(agg?.last_opened_at ? [new Date(agg.last_opened_at).getTime()] : []),
    ...linkConnections.map((c) => c.connected_at.getTime()),
    ...attributedBridgeIns.map((b) => b.timestampMs),
    ...attributedActivity.map((e) => e.timestampMs),
  ].filter(Number.isFinite);

  return {
    id: linkId,
    slug: link.slug,
    url: publicUrlForSlug(link.slug),
    label: link.label,
    source: link.source ?? "",
    destination: link.destination,
    creator: link.created_by,
    active: link.active,
    createdAt: link.created_at.toISOString(),
    opens: Number(agg?.opens ?? 0),
    engagedOpens: Number(agg?.engaged_opens ?? 0),
    botOpens: Number(agg?.bot_opens ?? 0),
    wallets: wallets.size,
    bridgedWallets: bridgedWallets.size,
    bridgeValueUsd,
    activatedWallets: activatedWallets.size,
    lastActivityAt: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null,
  };
};

export const getLinkSummaries = async (): Promise<LinkSummary[]> => {
  const snapshot = await getSnapshot();
  return snapshot.links.map((link) => summarizeLink(snapshot, link));
};

const activityKind = (event: ActivityEvent): LinkDetail["activity"][number]["kind"] => {
  if (event.contractName === "MetalForge") return "metal_purchase";
  if (event.contractName === "Pool" && event.eventName === "Swap") return "swap";
  return "other";
};

export const getLinkDetail = async (linkId: string): Promise<LinkDetail | null> => {
  const snapshot = await getSnapshot();
  const link = snapshot.links.find((l) => String(l.id) === String(linkId));
  if (!link) return null;
  const summary = summarizeLink(snapshot, link);

  const connections = snapshot.connections
    .filter((c) => String(c.link_id) === String(link.id) && !c.is_bot_or_preview)
    .map((c) => ({
      externalWalletAddress: c.external_wallet_address || null,
      stratoAddress: c.strato_address || null,
      connector: c.connector,
      connectedAt: c.connected_at.toISOString(),
    }));

  const bridgeIns = snapshot.bridgeIns
    .filter((b) => snapshot.assignments.get(b.eventKey)?.linkId === link.id)
    .map((b) => ({
      address: b.stratoRecipient || b.externalSender,
      asset: snapshot.tokenSymbols.get(b.stratoToken) ?? b.stratoToken.slice(0, 8),
      amount: tokenAmount(b.stratoTokenAmount).toLocaleString("en-US", {
        maximumFractionDigits: 6,
      }),
      amountUsd: (() => {
        const price = snapshot.oraclePrices.get(b.stratoToken);
        return price == null ? null : tokenAmount(b.stratoTokenAmount) * price;
      })(),
      txHash: b.txHash,
      at: new Date(b.timestampMs).toISOString(),
    }));

  const attributedActivity = snapshot.activityEvents
    .filter((e) => snapshot.assignments.get(e.eventKey)?.linkId === link.id)
    .sort((a, b) => a.timestampMs - b.timestampMs);

  const seenWallets = new Set<string>();
  const activity = attributedActivity.map((e) => {
    const isFirst = !seenWallets.has(e.userAddress);
    seenWallets.add(e.userAddress);
    return {
      kind: isFirst ? ("first_action" as const) : activityKind(e),
      description: `${e.contractName}: ${e.eventName}`,
      address: e.userAddress,
      txHash: null,
      at: new Date(e.timestampMs).toISOString(),
    };
  });

  return { ...summary, connections, bridgeIns, activity };
};
