import { query } from "../db/pool";
import { toCirrusAddress } from "../utils/addresses";
import { externalChainName } from "../utils/chains";
import { ActivityCategory } from "./cirrusService";
import {
  ActivitySummary,
  AttributionSnapshot,
  BridgeInItem,
  countByCategory,
  getSnapshot,
  toBridgeInItem,
  tokenAmount,
  walletKeyOf,
} from "./attributionService";

// "Today" is the UTC day, like every other rollup in this service (the
// per-day history, the daily session buckets). Deltas compare against the
// SAME ELAPSED WINDOW yesterday — comparing a half-finished day against a
// whole one would make every morning look like a collapse.

const HOURS_PER_DAY = 24;
const DAY_MS = HOURS_PER_DAY * 60 * 60 * 1000;
const TOP_LINKS = 6;

export interface MetricDelta {
  value: number;
  // Same-elapsed-window value from yesterday
  previous: number;
  // Percent change vs `previous`, one decimal; null when there is no
  // baseline (previous = 0) so the UI can say "new" instead of "+∞%"
  changePct: number | null;
}

export interface DailySnapshotLink {
  id: string;
  slug: string;
  label: string;
  source: string;
  opens: number;
}

export interface DailySnapshot {
  date: string; // YYYY-MM-DD (UTC)
  generatedAt: string;
  hour: number; // current UTC hour: the last (partial) opensByHour bucket
  linksTotal: number;
  linksWithOpens: number;
  opens: MetricDelta;
  engagedOpens: number;
  wallets: MetricDelta;
  bridgedWallets: number;
  bridgeValueUsd: MetricDelta;
  // Some of today's attributed bridge-ins carry an unpriced token, so the
  // USD figure is a floor ("$128.4K+"), not a total
  bridgeValuePartial: boolean;
  bridgeIns: number;
  actions: MetricDelta;
  actionLinks: number;
  opensByHour: number[]; // 24 UTC buckets
  topLinks: DailySnapshotLink[];
}

interface SessionTotalsRow {
  opens: number;
  engaged: number;
  links_with_opens: number;
  prev_opens: number;
}

interface HourRow {
  hour: number;
  opens: number;
}

interface LinkOpensRow {
  link_id: string;
  opens: number;
}

const changePct = (value: number, previous: number): number | null => {
  if (previous <= 0) return null;
  return Math.round(((value - previous) / previous) * 1000) / 10;
};

const delta = (value: number, previous: number): MetricDelta => ({
  value,
  previous,
  changePct: changePct(value, previous),
});

const inWindow = (ms: number, startMs: number, endMs: number): boolean =>
  Number.isFinite(ms) && ms >= startMs && ms < endMs;

// Wallets/bridge/action figures come from the cached attribution snapshot so
// the panel counts exactly what the links table counts (same 90-day
// most-recent-connection rule, one event never counted twice).
const chainMetrics = (snapshot: AttributionSnapshot, startMs: number, endMs: number) => {
  const wallets = new Set<string>();
  for (const conn of snapshot.connections) {
    if (conn.is_bot_or_preview) continue;
    if (!inWindow(conn.connected_at.getTime(), startMs, endMs)) continue;
    const key = walletKeyOf(conn);
    if (key) wallets.add(key);
  }

  const bridgedWallets = new Set<string>();
  let bridgeIns = 0;
  let bridgeValueUsd = 0;
  let bridgeValuePartial = false;
  for (const bridge of snapshot.bridgeIns) {
    if (!snapshot.assignments.has(bridge.eventKey)) continue;
    if (!inWindow(bridge.timestampMs, startMs, endMs)) continue;
    bridgeIns += 1;
    const wallet = bridge.stratoRecipient || bridge.externalSender;
    if (wallet) bridgedWallets.add(wallet);
    const price = snapshot.oraclePrices.get(bridge.stratoToken);
    if (price == null) bridgeValuePartial = true;
    else bridgeValueUsd += tokenAmount(bridge.stratoTokenAmount) * price;
  }

  let actions = 0;
  const actionLinks = new Set<string>();
  for (const event of snapshot.activityEvents) {
    const assignment = snapshot.assignments.get(event.eventKey);
    if (!assignment) continue;
    if (!inWindow(event.timestampMs, startMs, endMs)) continue;
    actions += 1;
    actionLinks.add(String(assignment.linkId));
  }

  return {
    wallets: wallets.size,
    bridgedWallets: bridgedWallets.size,
    bridgeIns,
    bridgeValueUsd,
    bridgeValuePartial,
    actions,
    actionLinks: actionLinks.size,
  };
};

// Today's headline numbers for every link at once: session rollups from SQL,
// wallet/chain rollups from the attribution snapshot, each against the same
// elapsed window yesterday.
export const getDailySnapshot = async (): Promise<DailySnapshot> => {
  const now = new Date();
  const dayStartMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
  const prevStartMs = dayStartMs - DAY_MS;
  const prevEndMs = prevStartMs + (now.getTime() - dayStartMs); // same elapsed slice
  const dayStart = new Date(dayStartMs);
  const prevStart = new Date(prevStartMs);
  const prevEnd = new Date(prevEndMs);

  const snapshot = await getSnapshot();

  const [totalsResult, hoursResult, topLinksResult] = await Promise.all([
    query<SessionTotalsRow>(
      `SELECT COUNT(*) FILTER (WHERE opened_at >= $1)::int AS opens,
              COUNT(*) FILTER (WHERE opened_at >= $1 AND engaged_at IS NOT NULL)::int AS engaged,
              COUNT(DISTINCT link_id) FILTER (WHERE opened_at >= $1)::int AS links_with_opens,
              COUNT(*) FILTER (WHERE opened_at >= $2 AND opened_at < $3)::int AS prev_opens
       FROM tracking_sessions
       WHERE NOT is_bot_or_preview AND opened_at >= $2`,
      [dayStart, prevStart, prevEnd]
    ),
    query<HourRow>(
      `SELECT EXTRACT(HOUR FROM opened_at AT TIME ZONE 'UTC')::int AS hour,
              COUNT(*)::int AS opens
       FROM tracking_sessions
       WHERE NOT is_bot_or_preview AND opened_at >= $1
       GROUP BY hour`,
      [dayStart]
    ),
    query<LinkOpensRow>(
      `SELECT link_id, COUNT(*)::int AS opens
       FROM tracking_sessions
       WHERE NOT is_bot_or_preview AND opened_at >= $1
       GROUP BY link_id
       ORDER BY opens DESC, link_id ASC
       LIMIT $2`,
      [dayStart, TOP_LINKS]
    ),
  ]);

  const totals = totalsResult.rows[0];
  const opensByHour = new Array<number>(HOURS_PER_DAY).fill(0);
  for (const row of hoursResult.rows) {
    const hour = Number(row.hour);
    if (hour >= 0 && hour < HOURS_PER_DAY) opensByHour[hour] = Number(row.opens);
  }

  const linksById = new Map(snapshot.links.map((link) => [String(link.id), link]));
  const topLinks: DailySnapshotLink[] = topLinksResult.rows.flatMap((row) => {
    const link = linksById.get(String(row.link_id));
    return link
      ? [
          {
            id: String(link.id),
            slug: link.slug,
            label: link.label,
            source: link.source ?? "",
            opens: Number(row.opens),
          },
        ]
      : [];
  });

  // Today runs to the end of the UTC day, not to `now`: chain timestamps come
  // from block time and can sit slightly ahead of this server's clock.
  const today = chainMetrics(snapshot, dayStartMs, dayStartMs + DAY_MS);
  const yesterday = chainMetrics(snapshot, prevStartMs, prevEndMs);

  return {
    date: new Date(dayStartMs).toISOString().slice(0, 10),
    generatedAt: now.toISOString(),
    hour: now.getUTCHours(),
    linksTotal: snapshot.links.length,
    linksWithOpens: Number(totals?.links_with_opens ?? 0),
    opens: delta(Number(totals?.opens ?? 0), Number(totals?.prev_opens ?? 0)),
    engagedOpens: Number(totals?.engaged ?? 0),
    wallets: delta(today.wallets, yesterday.wallets),
    bridgedWallets: today.bridgedWallets,
    bridgeValueUsd: delta(today.bridgeValueUsd, yesterday.bridgeValueUsd),
    bridgeValuePartial: today.bridgeValuePartial,
    bridgeIns: today.bridgeIns,
    actions: delta(today.actions, yesterday.actions),
    actionLinks: today.actionLinks,
    opensByHour,
    topLinks,
  };
};

// ---------------------------------------------------------------------------
// Breakdowns behind the snapshot tiles
// ---------------------------------------------------------------------------
// Each tile on the Daily Snapshot is a single number; these are the rows that
// number is made of, over the SAME UTC-today window, so a tile and its table
// can never disagree. Lists are newest-first and capped (`truncated` says the
// tail was cut) — this is a drill-down, not an export.

const MAX_ROWS = 500;

export interface BreakdownLink {
  id: string;
  slug: string;
  label: string;
  source: string;
}

// One open (session). `address` is the wallet identity connected during that
// visit, or null for a visitor who never connected one; raw IPs stay private.
export interface OpenRow {
  at: string;
  engaged: boolean;
  link: BreakdownLink | null;
  city: string | null;
  country: string | null;
  referrer: string | null;
  address: string | null;
}

// One wallet identity that connected today. The bridge/action figures cover
// today's attributed events for that wallet — the same window as the tiles, so
// a wallet that connects today and bridges tomorrow reads 0 here today.
export interface WalletRow {
  address: string;
  externalWalletAddress: string | null;
  stratoAddress: string | null;
  connector: string | null;
  connectedAt: string;
  // Open that started the session the wallet connected in
  firstOpenAt: string | null;
  link: BreakdownLink | null;
  city: string | null;
  country: string | null;
  bridgeIns: number;
  bridgeValueUsd: number;
  // An unpriced bridged token makes bridgeValueUsd a floor, not a total
  bridgeValuePartial: boolean;
  assets: string[];
  actions: number;
  actionSummary: ActivitySummary;
  lastActivityAt: string | null;
}

export interface BridgeRow extends BridgeInItem {
  link: BreakdownLink | null;
  chainName: string | null;
}

export interface ActionCategoryRow {
  category: ActivityCategory;
  count: number;
  wallets: number;
  links: number;
}

export interface ActionRow {
  at: string;
  category: ActivityCategory;
  description: string;
  address: string;
  link: BreakdownLink | null;
}

export interface BreakdownSection<Row> {
  total: number; // matches the tile
  shown: number;
  truncated: boolean;
  rows: Row[];
}

export interface DailyBreakdown {
  date: string; // YYYY-MM-DD (UTC), same window as the snapshot
  generatedAt: string;
  opens: BreakdownSection<OpenRow>;
  wallets: BreakdownSection<WalletRow>;
  bridgeIns: BreakdownSection<BridgeRow> & {
    valueUsd: number;
    valuePartial: boolean;
  };
  actions: BreakdownSection<ActionRow> & { byCategory: ActionCategoryRow[] };
}

interface OpenDetailRow {
  link_id: string;
  opened_at: Date;
  engaged: boolean;
  geo_city: string | null;
  geo_country: string | null;
  referrer: string | null;
  address: string | null;
}

interface SessionGeoRow {
  id: string;
  opened_at: Date;
  geo_city: string | null;
  geo_country: string | null;
}

const section = <Row>(total: number, rows: Row[]): BreakdownSection<Row> => ({
  total,
  shown: rows.length,
  truncated: rows.length < total,
  rows,
});

// Today's wallet identities, keyed like the wallets tile counts them
// (walletKeyOf): the connection rows of one visitor collapse into one row.
interface TodayIdentity {
  key: string;
  addresses: Set<string>;
  externalWalletAddress: string | null;
  stratoAddress: string | null;
  connector: string | null;
  connectedAt: Date;
  linkId: string;
  sessionId: string;
}

const todayIdentities = (
  snapshot: AttributionSnapshot,
  startMs: number,
  endMs: number
): TodayIdentity[] => {
  const identities = new Map<string, TodayIdentity>();
  for (const conn of snapshot.connections) {
    if (conn.is_bot_or_preview) continue;
    if (!inWindow(conn.connected_at.getTime(), startMs, endMs)) continue;
    const key = walletKeyOf(conn);
    if (!key) continue;
    let identity = identities.get(key);
    if (!identity) {
      identity = {
        key,
        addresses: new Set(),
        externalWalletAddress: null,
        stratoAddress: null,
        connector: null,
        connectedAt: conn.connected_at,
        linkId: String(conn.link_id),
        sessionId: String(conn.session_id),
      };
      identities.set(key, identity);
    }
    if (conn.external_wallet_address) {
      identity.externalWalletAddress = conn.external_wallet_address;
      identity.addresses.add(toCirrusAddress(conn.external_wallet_address));
    }
    if (conn.strato_address) {
      identity.stratoAddress = conn.strato_address;
      identity.addresses.add(toCirrusAddress(conn.strato_address));
    }
    identity.connector = identity.connector ?? conn.connector;
    // Earliest connection of the day owns the "link used" and the session
    if (conn.connected_at < identity.connectedAt) {
      identity.connectedAt = conn.connected_at;
      identity.linkId = String(conn.link_id);
      identity.sessionId = String(conn.session_id);
    }
  }
  return [...identities.values()];
};

// Rows behind all four tiles for today's UTC window.
export const getDailyBreakdown = async (): Promise<DailyBreakdown> => {
  const now = new Date();
  const dayStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dayEndMs = dayStartMs + DAY_MS;
  const dayStart = new Date(dayStartMs);

  const snapshot = await getSnapshot();
  const linkRefs = new Map<string, BreakdownLink>(
    snapshot.links.map((link) => [
      String(link.id),
      { id: String(link.id), slug: link.slug, label: link.label, source: link.source ?? "" },
    ])
  );
  const linkRef = (linkId: string | null | undefined): BreakdownLink | null =>
    linkId == null ? null : linkRefs.get(String(linkId)) ?? null;

  // ---- opens ------------------------------------------------------------
  const [opensCountResult, opensResult] = await Promise.all([
    query<{ opens: number }>(
      `SELECT COUNT(*)::int AS opens
       FROM tracking_sessions
       WHERE NOT is_bot_or_preview AND opened_at >= $1`,
      [dayStart]
    ),
    query<OpenDetailRow>(
      `SELECT s.link_id, s.opened_at, s.engaged_at IS NOT NULL AS engaged,
              s.geo_city, s.geo_country, s.referrer,
              COALESCE(NULLIF(wc.external_wallet_address, ''), NULLIF(wc.strato_address, '')) AS address
       FROM tracking_sessions s
       LEFT JOIN LATERAL (
         SELECT external_wallet_address, strato_address
         FROM wallet_connections
         WHERE session_id = s.id
         ORDER BY connected_at ASC, id ASC
         LIMIT 1
       ) wc ON TRUE
       WHERE NOT s.is_bot_or_preview AND s.opened_at >= $1
       ORDER BY s.opened_at DESC
       LIMIT $2`,
      [dayStart, MAX_ROWS]
    ),
  ]);
  const openRows: OpenRow[] = opensResult.rows.map((row) => ({
    at: row.opened_at.toISOString(),
    engaged: Boolean(row.engaged),
    link: linkRef(row.link_id),
    city: row.geo_city,
    country: row.geo_country,
    referrer: row.referrer,
    address: row.address || null,
  }));

  // ---- wallets ----------------------------------------------------------
  const identities = todayIdentities(snapshot, dayStartMs, dayEndMs);
  // The opens that started today's wallet sessions, for "first open" and geo
  const sessionIds = [...new Set(identities.map((i) => i.sessionId))];
  const sessionsResult = sessionIds.length
    ? await query<SessionGeoRow>(
        `SELECT id, opened_at, geo_city, geo_country
         FROM tracking_sessions
         WHERE id = ANY($1::uuid[])`,
        [sessionIds]
      )
    : { rows: [] as SessionGeoRow[] };
  const sessions = new Map(sessionsResult.rows.map((row) => [String(row.id), row]));

  const walletRows: WalletRow[] = identities
    .sort((a, b) => b.connectedAt.getTime() - a.connectedAt.getTime())
    .slice(0, MAX_ROWS)
    .map((identity) => {
      const bridges = snapshot.bridgeIns.filter(
        (b) =>
          snapshot.assignments.has(b.eventKey) &&
          inWindow(b.timestampMs, dayStartMs, dayEndMs) &&
          (identity.addresses.has(b.stratoRecipient) || identity.addresses.has(b.externalSender))
      );
      const events = snapshot.activityEvents.filter(
        (e) =>
          snapshot.assignments.has(e.eventKey) &&
          inWindow(e.timestampMs, dayStartMs, dayEndMs) &&
          identity.addresses.has(e.userAddress)
      );
      let bridgeValueUsd = 0;
      let bridgeValuePartial = false;
      const assets = new Set<string>();
      for (const bridge of bridges) {
        assets.add(snapshot.tokenSymbols.get(bridge.stratoToken) ?? bridge.stratoToken.slice(0, 8));
        const price = snapshot.oraclePrices.get(bridge.stratoToken);
        if (price == null) bridgeValuePartial = true;
        else bridgeValueUsd += tokenAmount(bridge.stratoTokenAmount) * price;
      }
      const timestamps = [...bridges.map((b) => b.timestampMs), ...events.map((e) => e.timestampMs)];
      const session = sessions.get(identity.sessionId);
      return {
        address: identity.key,
        externalWalletAddress: identity.externalWalletAddress,
        stratoAddress: identity.stratoAddress,
        connector: identity.connector,
        connectedAt: identity.connectedAt.toISOString(),
        firstOpenAt: session ? session.opened_at.toISOString() : null,
        link: linkRef(identity.linkId),
        city: session?.geo_city ?? null,
        country: session?.geo_country ?? null,
        bridgeIns: bridges.length,
        bridgeValueUsd,
        bridgeValuePartial,
        assets: [...assets],
        actions: events.length,
        actionSummary: countByCategory(events, 0),
        lastActivityAt: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null,
      };
    });

  // ---- bridged in -------------------------------------------------------
  const todayBridges = snapshot.bridgeIns
    .filter((b) => snapshot.assignments.has(b.eventKey) && inWindow(b.timestampMs, dayStartMs, dayEndMs))
    .sort((a, b) => b.timestampMs - a.timestampMs);
  let bridgeValueUsd = 0;
  let bridgeValuePartial = false;
  for (const bridge of todayBridges) {
    const price = snapshot.oraclePrices.get(bridge.stratoToken);
    if (price == null) bridgeValuePartial = true;
    else bridgeValueUsd += tokenAmount(bridge.stratoTokenAmount) * price;
  }
  const bridgeRows: BridgeRow[] = todayBridges.slice(0, MAX_ROWS).map((bridge) => ({
    ...toBridgeInItem(snapshot, bridge),
    link: linkRef(snapshot.assignments.get(bridge.eventKey)?.linkId),
    chainName: externalChainName(bridge.externalChainId),
  }));

  // ---- on-chain actions -------------------------------------------------
  const todayActions = snapshot.activityEvents
    .filter((e) => snapshot.assignments.has(e.eventKey) && inWindow(e.timestampMs, dayStartMs, dayEndMs))
    .sort((a, b) => b.timestampMs - a.timestampMs);
  const groups = new Map<ActivityCategory, { count: number; wallets: Set<string>; links: Set<string> }>();
  for (const event of todayActions) {
    let group = groups.get(event.category);
    if (!group) {
      group = { count: 0, wallets: new Set(), links: new Set() };
      groups.set(event.category, group);
    }
    group.count += 1;
    if (event.userAddress) group.wallets.add(event.userAddress);
    const linkId = snapshot.assignments.get(event.eventKey)?.linkId;
    if (linkId != null) group.links.add(String(linkId));
  }
  const byCategory: ActionCategoryRow[] = [...groups.entries()]
    .map(([category, group]) => ({
      category,
      count: group.count,
      wallets: group.wallets.size,
      links: group.links.size,
    }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  const actionRows: ActionRow[] = todayActions.slice(0, MAX_ROWS).map((event) => ({
    at: new Date(event.timestampMs).toISOString(),
    category: event.category,
    description: `${event.contractName}: ${event.eventName}`,
    address: event.userAddress,
    link: linkRef(snapshot.assignments.get(event.eventKey)?.linkId),
  }));

  return {
    date: new Date(dayStartMs).toISOString().slice(0, 10),
    generatedAt: now.toISOString(),
    opens: section(Number(opensCountResult.rows[0]?.opens ?? 0), openRows),
    wallets: section(identities.length, walletRows),
    bridgeIns: { ...section(todayBridges.length, bridgeRows), valueUsd: bridgeValueUsd, valuePartial: bridgeValuePartial },
    actions: { ...section(todayActions.length, actionRows), byCategory },
  };
};
