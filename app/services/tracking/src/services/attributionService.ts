import { config } from "../config";
import { query } from "../db/pool";
import { listLinks, publicUrlForSlug, TrackingLink } from "./linkService";
import {
  ActivityCategory,
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

interface SessionDailyRow {
  link_id: string;
  day: string; // YYYY-MM-DD (UTC)
  opens: string;
  engaged: string;
}

// One geolocated visit (session), not an aggregate: the map needs per-visit
// timestamps (time-range filtering) and the visitor's wallet identity
// (click-through to their timeline).
interface GeoVisitRow {
  link_id: string;
  opened_at: Date;
  geo_lat: number;
  geo_lon: number;
  geo_city: string | null;
  geo_country: string | null;
  address: string | null;
}

interface Attribution {
  linkId: string;
  connectionId: string;
}

export type ActivitySummary = Partial<Record<ActivityCategory, number>>;

// A single open at a coordinate. `address` is the session's wallet identity
// (external-first, like walletKeyOf) or null for a visitor who never
// connected a wallet; raw IPs are never exposed.
export interface GeoVisit {
  at: string;
  address: string | null;
}

export interface GeoPoint {
  lat: number;
  lon: number;
  city: string | null;
  country: string | null;
  count: number;
  visits: GeoVisit[]; // newest first; count === visits.length
}

export interface LinkSummary {
  id: string;
  slug: string;
  url: string;
  label: string;
  source: string;
  fullSource: string;
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

export interface WalletSummary {
  // Primary identity key (external address if present, else STRATO address)
  address: string;
  externalWalletAddress: string | null;
  stratoAddress: string | null;
  connector: string | null;
  connectedAt: string;
  // Counts over the wallet's FULL on-chain activity (not attribution-filtered)
  activitySummary: ActivitySummary;
  lastActivityAt: string | null;
}

export interface ActivityItem {
  category: ActivityCategory;
  description: string;
  address: string;
  txHash: string | null;
  at: string;
}

export interface BridgeInItem {
  address: string;
  asset: string;
  amount: string;
  amountUsd: number | null;
  txHash: string | null;
  // Origin transaction on the external chain (Ethereum, Base, …), for
  // etherscan/basescan-style links alongside the STRATO explorer link
  externalChainId: number | null;
  externalTxHash: string | null;
  at: string;
}

// One UTC day of link history; gaps in the span are filled with zero points so
// per-day histograms don't silently skip quiet days.
export interface HistoryPoint {
  date: string; // YYYY-MM-DD (UTC)
  opens: number;
  engagedOpens: number;
  wallets: number;
  bridgeIns: number;
  bridgeValueUsd: number;
  trades: number;
  tradeValueUsd: number;
  activity: number;
}

export interface LinkDetail extends LinkSummary {
  bridgeIns: BridgeInItem[];
  // Attributed-to-this-link events only (the link's own metric)
  activity: ActivityItem[];
  activitySummary: ActivitySummary;
  walletSummaries: WalletSummary[];
  geoPoints: GeoPoint[];
  // True when the link has more geolocated opens than the per-link cap, so
  // the map only shows the most recent ones
  geoTruncated: boolean;
  history: HistoryPoint[];
}

export interface WalletDetail {
  address: string;
  addresses: string[];
  externalWalletAddress: string | null;
  stratoAddress: string | null;
  connector: string | null;
  connectedAt: string;
  activitySummary: ActivitySummary;
  bridgeIns: BridgeInItem[];
  activity: ActivityItem[];
}

export interface AttributionSnapshot {
  links: TrackingLink[];
  connections: ConnectionRow[];
  sessionAggs: Map<string, SessionAgg>;
  sessionDaily: SessionDailyRow[];
  geoVisits: GeoVisitRow[];
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

// Cap on the per-visit map payload: a link with more geolocated opens than
// this only maps its newest ones (surfaced as LinkDetail.geoTruncated).
const MAX_GEO_VISITS_PER_LINK = 5000;

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

  const sessionDailyResult = await query<SessionDailyRow>(
    `SELECT link_id,
            to_char(opened_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
            COUNT(*) FILTER (WHERE NOT is_bot_or_preview) AS opens,
            COUNT(*) FILTER (WHERE engaged_at IS NOT NULL) AS engaged
     FROM tracking_sessions
     GROUP BY link_id, day`
  );
  const sessionDaily = sessionDailyResult.rows;

  // Newest MAX_GEO_VISITS_PER_LINK geolocated opens per link, each carrying
  // the session's first wallet connection (if any) so a map dot can link to
  // that visitor's timeline.
  const geoVisitsResult = await query<GeoVisitRow>(
    `WITH ranked AS (
       SELECT id, link_id, opened_at, geo_lat, geo_lon, geo_city, geo_country,
              ROW_NUMBER() OVER (PARTITION BY link_id ORDER BY opened_at DESC, id) AS rn
       FROM tracking_sessions
       WHERE NOT is_bot_or_preview AND geo_lat IS NOT NULL AND geo_lon IS NOT NULL
     )
     SELECT r.link_id, r.opened_at, r.geo_lat, r.geo_lon, r.geo_city, r.geo_country,
            COALESCE(NULLIF(wc.external_wallet_address, ''), NULLIF(wc.strato_address, '')) AS address
     FROM ranked r
     LEFT JOIN LATERAL (
       SELECT external_wallet_address, strato_address
       FROM wallet_connections
       WHERE session_id = r.id
       ORDER BY connected_at ASC, id ASC
       LIMIT 1
     ) wc ON TRUE
     WHERE r.rn <= $1
     ORDER BY r.link_id, r.opened_at DESC`,
    [MAX_GEO_VISITS_PER_LINK]
  );
  const geoVisits = geoVisitsResult.rows;

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
  // Prices are fetched unconditionally: swap events (trade value history) need
  // them even when no bridge tokens are in play.
  const [tokenSymbols, oraclePrices] = await Promise.all([
    fetchTokenSymbols(tokenAddresses),
    fetchOraclePricesUsd(),
  ]);

  return {
    links,
    connections,
    sessionAggs,
    sessionDaily,
    geoVisits,
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

export const tokenAmount = (raw: string): number => {
  try {
    return Number(BigInt(raw)) / 1e18;
  } catch {
    return 0;
  }
};

// Identity key for counting distinct wallets. External-address-first so a
// visitor whose MetaMask connect precedes their STRATO login (two rows: one
// ext-only, one ext+strato) counts as one wallet, not two.
export const walletKeyOf = (conn: ConnectionRow): string =>
  conn.external_wallet_address || conn.strato_address;

export const countByCategory = (
  events: ActivityEvent[],
  bridgeInCount: number
): ActivitySummary => {
  const summary: ActivitySummary = {};
  if (bridgeInCount > 0) summary.bridge_in = bridgeInCount;
  for (const event of events) {
    summary[event.category] = (summary[event.category] ?? 0) + 1;
  }
  return summary;
};

export const toBridgeInItem = (
  snapshot: AttributionSnapshot,
  b: BridgeInEvent
): BridgeInItem => ({
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
  externalChainId: b.externalChainId,
  externalTxHash: b.externalTxHash,
  at: new Date(b.timestampMs).toISOString(),
});

const toActivityItem = (event: ActivityEvent): ActivityItem => ({
  category: event.category,
  description: `${event.contractName}: ${event.eventName}`,
  address: event.userAddress,
  txHash: null, // the unified Cirrus event table has no transaction_hash column
  at: new Date(event.timestampMs).toISOString(),
});

// Pool.Swap(sender, tokenIn, tokenOut, amountIn, amountOut) — both amounts are
// raw 1e18-scaled integers. Price the input leg, falling back to the output
// leg when only one side has an oracle price; null when neither does.
const swapValueUsd = (snapshot: AttributionSnapshot, event: ActivityEvent): number | null => {
  const legs: [string | undefined, string | undefined][] = [
    [event.attributes.tokenIn, event.attributes.amountIn],
    [event.attributes.tokenOut, event.attributes.amountOut],
  ];
  for (const [token, amount] of legs) {
    if (!token || !amount) continue;
    const price = snapshot.oraclePrices.get(token.toLowerCase());
    if (price != null) return tokenAmount(amount) * price;
  }
  return null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_HISTORY_DAYS = 1096; // clamp: a bad timestamp can't yield a decade of buckets

const dayKeyOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const zeroPoint = (date: string): HistoryPoint => ({
  date,
  opens: 0,
  engagedOpens: 0,
  wallets: 0,
  bridgeIns: 0,
  bridgeValueUsd: 0,
  trades: 0,
  tradeValueUsd: 0,
  activity: 0,
});

// Per-day history for one link: sessions from the DB daily rollup, everything
// else bucketed from the (already attributed) snapshot arrays. USD sums count
// priced tokens only — a trend line, unlike the headline total, has no way to
// show "unknown".
const buildHistory = (
  snapshot: AttributionSnapshot,
  link: TrackingLink,
  identities: WalletIdentity[],
  attributedBridgeIns: BridgeInEvent[],
  attributedActivity: ActivityEvent[]
): HistoryPoint[] => {
  const linkId = String(link.id);
  const byDay = new Map<string, HistoryPoint>();
  const at = (date: string): HistoryPoint => {
    let point = byDay.get(date);
    if (!point) {
      point = zeroPoint(date);
      byDay.set(date, point);
    }
    return point;
  };

  for (const row of snapshot.sessionDaily) {
    if (String(row.link_id) !== linkId) continue;
    const point = at(row.day);
    point.opens += Number(row.opens);
    point.engagedOpens += Number(row.engaged);
  }
  for (const identity of identities) {
    at(dayKeyOf(identity.connectedAt.getTime())).wallets += 1;
  }
  for (const bridge of attributedBridgeIns) {
    const point = at(dayKeyOf(bridge.timestampMs));
    point.bridgeIns += 1;
    const price = snapshot.oraclePrices.get(bridge.stratoToken);
    if (price != null) point.bridgeValueUsd += tokenAmount(bridge.stratoTokenAmount) * price;
  }
  for (const event of attributedActivity) {
    const point = at(dayKeyOf(event.timestampMs));
    point.activity += 1;
    if (event.category === "swap") {
      point.trades += 1;
      const value = swapValueUsd(snapshot, event);
      if (value != null) point.tradeValueUsd += value;
    }
  }
  if (byDay.size === 0) return [];

  const dataDays = [...byDay.keys()].sort();
  const startDay =
    dayKeyOf(link.created_at.getTime()) < dataDays[0]
      ? dayKeyOf(link.created_at.getTime())
      : dataDays[0];
  const endMs = Math.max(Date.now(), Date.parse(dataDays[dataDays.length - 1]));

  const points: HistoryPoint[] = [];
  for (let ms = Date.parse(startDay); ms <= endMs && points.length < MAX_HISTORY_DAYS; ms += DAY_MS) {
    const date = dayKeyOf(ms);
    points.push(byDay.get(date) ?? zeroPoint(date));
  }
  return points;
};

interface WalletIdentity {
  address: string;
  externalWalletAddress: string | null;
  stratoAddress: string | null;
  connector: string | null;
  connectedAt: Date;
  addresses: Set<string>;
}

// Distinct wallet identities for a link, merging connection rows that share
// an identity key (e.g. the ext-only row and the later ext+strato row).
const walletIdentitiesForLink = (
  snapshot: AttributionSnapshot,
  linkId: string
): WalletIdentity[] => {
  const identities = new Map<string, WalletIdentity>();
  for (const conn of snapshot.connections) {
    if (String(conn.link_id) !== String(linkId) || conn.is_bot_or_preview) continue;
    const key = walletKeyOf(conn);
    if (!key) continue;
    let identity = identities.get(key);
    if (!identity) {
      identity = {
        address: key,
        externalWalletAddress: null,
        stratoAddress: null,
        connector: null,
        connectedAt: conn.connected_at,
        addresses: new Set(),
      };
      identities.set(key, identity);
    }
    if (conn.external_wallet_address) {
      identity.externalWalletAddress = conn.external_wallet_address;
      identity.addresses.add(conn.external_wallet_address);
    }
    if (conn.strato_address) {
      identity.stratoAddress = conn.strato_address;
      identity.addresses.add(conn.strato_address);
    }
    identity.connector = identity.connector ?? conn.connector;
    if (conn.connected_at < identity.connectedAt) identity.connectedAt = conn.connected_at;
  }
  return [...identities.values()];
};

// Full (not attribution-filtered) on-chain history for a set of addresses
const fullActivityFor = (snapshot: AttributionSnapshot, addresses: Set<string>) => {
  const events = snapshot.activityEvents.filter((e) => addresses.has(e.userAddress));
  const bridgeIns = snapshot.bridgeIns.filter(
    (b) => addresses.has(b.stratoRecipient) || addresses.has(b.externalSender)
  );
  return { events, bridgeIns };
};

const summarizeWallet = (
  snapshot: AttributionSnapshot,
  identity: WalletIdentity
): WalletSummary => {
  const { events, bridgeIns } = fullActivityFor(snapshot, identity.addresses);
  const timestamps = [
    ...events.map((e) => e.timestampMs),
    ...bridgeIns.map((b) => b.timestampMs),
  ].filter(Number.isFinite);
  return {
    address: identity.address,
    externalWalletAddress: identity.externalWalletAddress,
    stratoAddress: identity.stratoAddress,
    connector: identity.connector,
    connectedAt: identity.connectedAt.toISOString(),
    activitySummary: countByCategory(events, bridgeIns.length),
    lastActivityAt: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null,
  };
};

const summarizeLink = (snapshot: AttributionSnapshot, link: TrackingLink): LinkSummary => {
  const linkId = String(link.id);
  const agg = snapshot.sessionAggs.get(linkId);

  const identities = walletIdentitiesForLink(snapshot, linkId);

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
    ...identities.map((i) => i.connectedAt.getTime()),
    ...attributedBridgeIns.map((b) => b.timestampMs),
    ...attributedActivity.map((e) => e.timestampMs),
  ].filter(Number.isFinite);

  return {
    id: linkId,
    slug: link.slug,
    url: publicUrlForSlug(link.slug),
    label: link.label,
    source: link.source ?? "",
    fullSource: link.full_source ?? "",
    destination: link.destination,
    creator: link.created_by,
    active: link.active,
    createdAt: link.created_at.toISOString(),
    opens: Number(agg?.opens ?? 0),
    engagedOpens: Number(agg?.engaged_opens ?? 0),
    botOpens: Number(agg?.bot_opens ?? 0),
    wallets: identities.length,
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

export const getLinkDetail = async (linkId: string): Promise<LinkDetail | null> => {
  const snapshot = await getSnapshot();
  const link = snapshot.links.find((l) => String(l.id) === String(linkId));
  if (!link) return null;
  const summary = summarizeLink(snapshot, link);

  const attributedBridgeIns = snapshot.bridgeIns
    .filter((b) => snapshot.assignments.get(b.eventKey)?.linkId === link.id)
    .sort((a, b) => b.timestampMs - a.timestampMs);
  const attributedActivity = snapshot.activityEvents
    .filter((e) => snapshot.assignments.get(e.eventKey)?.linkId === link.id)
    .sort((a, b) => b.timestampMs - a.timestampMs);

  const identities = walletIdentitiesForLink(snapshot, String(link.id));
  const walletSummaries = identities
    .map((identity) => summarizeWallet(snapshot, identity))
    .sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));

  // One point per coordinate, holding its visits newest first (the query
  // already orders by opened_at DESC). Points are sorted by count so the
  // payload order is stable.
  const geoVisitRows = snapshot.geoVisits.filter(
    (row) => String(row.link_id) === String(link.id)
  );
  const geoByCoordinate = new Map<string, GeoPoint>();
  for (const row of geoVisitRows) {
    const key = `${row.geo_lat}|${row.geo_lon}|${row.geo_city ?? ""}|${row.geo_country ?? ""}`;
    let point = geoByCoordinate.get(key);
    if (!point) {
      point = {
        lat: row.geo_lat,
        lon: row.geo_lon,
        city: row.geo_city,
        country: row.geo_country,
        count: 0,
        visits: [],
      };
      geoByCoordinate.set(key, point);
    }
    point.visits.push({ at: row.opened_at.toISOString(), address: row.address || null });
    point.count = point.visits.length;
  }
  const geoPoints: GeoPoint[] = [...geoByCoordinate.values()].sort((a, b) => b.count - a.count);

  return {
    ...summary,
    bridgeIns: attributedBridgeIns.map((b) => toBridgeInItem(snapshot, b)),
    activity: attributedActivity.map(toActivityItem),
    activitySummary: countByCategory(attributedActivity, attributedBridgeIns.length),
    walletSummaries,
    geoPoints,
    geoTruncated: geoVisitRows.length >= MAX_GEO_VISITS_PER_LINK,
    history: buildHistory(snapshot, link, identities, attributedBridgeIns, attributedActivity),
  };
};

// Per-user drill-down: the wallet's FULL on-chain history (labeled as such in
// the UI) — a prospect's pre-link activity is sales signal, so this view is
// deliberately not attribution-filtered; link-level metrics remain attributed.
export const getWalletDetail = async (
  linkId: string,
  address: string
): Promise<WalletDetail | null> => {
  const snapshot = await getSnapshot();
  const link = snapshot.links.find((l) => String(l.id) === String(linkId));
  if (!link) return null;

  const identity = walletIdentitiesForLink(snapshot, String(link.id)).find(
    (candidate) => candidate.address === address || candidate.addresses.has(address)
  );
  if (!identity) return null;

  const { events, bridgeIns } = fullActivityFor(snapshot, identity.addresses);
  const sorted = [...events].sort((a, b) => b.timestampMs - a.timestampMs);

  return {
    address: identity.address,
    addresses: [...identity.addresses],
    externalWalletAddress: identity.externalWalletAddress,
    stratoAddress: identity.stratoAddress,
    connector: identity.connector,
    connectedAt: identity.connectedAt.toISOString(),
    activitySummary: countByCategory(events, bridgeIns.length),
    bridgeIns: bridgeIns
      .sort((a, b) => b.timestampMs - a.timestampMs)
      .map((b) => toBridgeInItem(snapshot, b)),
    activity: sorted.map(toActivityItem),
  };
};
