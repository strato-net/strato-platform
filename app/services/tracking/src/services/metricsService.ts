import { query } from "../db/pool";
import { toCirrusAddress } from "../utils/addresses";
import { externalChainName } from "../utils/chains";
import { ActivityCategory, ActivityEvent, BridgeInEvent } from "./cirrusService";
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

// Windows are whole UTC days, like every other rollup in this service (the
// per-day history, the daily session buckets). Deltas compare against the
// window of the SAME LENGTH immediately before it — and, while that window is
// still running, only against its SAME ELAPSED SLICE: comparing a
// half-finished day against a whole one would make every morning look like a
// collapse.

const HOURS_PER_DAY = 24;
const DAY_MS = HOURS_PER_DAY * 60 * 60 * 1000;
const TOP_LINKS = 6;

// The periods the dashboard panel can look at. `today` is the default so the
// endpoints stay backwards compatible with callers that send no `period`.
export const METRICS_PERIODS = ["today", "yesterday", "7d", "30d"] as const;

export type MetricsPeriod = (typeof METRICS_PERIODS)[number];

// null = the caller sent something that is not a period (the controller
// answers 400); missing/empty means "today".
export const parsePeriod = (raw: unknown): MetricsPeriod | null => {
  if (raw == null || raw === "") return "today";
  if (typeof raw !== "string") return null;
  return (METRICS_PERIODS as readonly string[]).includes(raw)
    ? (raw as MetricsPeriod)
    : null;
};

// One window definition drives the tiles AND the breakdown rows, so a table
// can never disagree with the number above it.
interface PeriodWindow {
  period: MetricsPeriod;
  days: number; // UTC days covered
  startMs: number; // inclusive
  // Exclusive end of the last UTC day in the window. For a window that
  // includes today this sits in the future on purpose: chain timestamps come
  // from block time and can sit slightly ahead of this server's clock.
  endMs: number;
  prevStartMs: number;
  prevEndMs: number;
  startDate: string; // YYYY-MM-DD (UTC)
  endDate: string; // YYYY-MM-DD (UTC), the window's last day
}

const dayString = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const periodWindow = (period: MetricsPeriod, now: Date): PeriodWindow => {
  const todayStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = period === "7d" ? 7 : period === "30d" ? 30 : 1;
  const includesToday = period !== "yesterday";
  const endMs = includesToday ? todayStartMs + DAY_MS : todayStartMs;
  const startMs = endMs - days * DAY_MS;
  const spanMs = days * DAY_MS;
  // A still-running window is only compared against the same elapsed slice of
  // the preceding one; a finished window against the whole of it.
  const elapsedMs = includesToday
    ? Math.max(0, Math.min(now.getTime() - startMs, spanMs))
    : spanMs;
  const prevStartMs = startMs - spanMs;
  return {
    period,
    days,
    startMs,
    endMs,
    prevStartMs,
    prevEndMs: prevStartMs + elapsedMs,
    startDate: dayString(startMs),
    endDate: dayString(endMs - DAY_MS),
  };
};

export interface MetricDelta {
  value: number;
  // Value of the preceding window of the same length (its same elapsed slice
  // while the current window is still running)
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
  period: MetricsPeriod;
  days: number; // UTC days the window covers (1, 7 or 30)
  date: string; // YYYY-MM-DD (UTC): the window's last day
  startDate: string; // YYYY-MM-DD (UTC)
  endDate: string; // YYYY-MM-DD (UTC), same as `date`
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
  // 24 UTC hour-of-day buckets; over a multi-day window every day's opens
  // land in the same 24 buckets
  opensByHour: number[];
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

// The window's headline numbers for every link at once: session rollups from
// SQL, wallet/chain rollups from the attribution snapshot, each against the
// preceding window of the same length.
export const getDailySnapshot = async (
  period: MetricsPeriod = "today"
): Promise<DailySnapshot> => {
  const now = new Date();
  const window = periodWindow(period, now);
  const start = new Date(window.startMs);
  const end = new Date(window.endMs);
  const prevStart = new Date(window.prevStartMs);
  const prevEnd = new Date(window.prevEndMs);

  const snapshot = await getSnapshot();

  const [totalsResult, hoursResult, topLinksResult] = await Promise.all([
    query<SessionTotalsRow>(
      `SELECT COUNT(*) FILTER (WHERE opened_at >= $1 AND opened_at < $2)::int AS opens,
              COUNT(*) FILTER (WHERE opened_at >= $1 AND opened_at < $2 AND engaged_at IS NOT NULL)::int AS engaged,
              COUNT(DISTINCT link_id) FILTER (WHERE opened_at >= $1 AND opened_at < $2)::int AS links_with_opens,
              COUNT(*) FILTER (WHERE opened_at >= $3 AND opened_at < $4)::int AS prev_opens
       FROM tracking_sessions
       WHERE NOT is_bot_or_preview AND opened_at >= $3 AND opened_at < $2`,
      [start, end, prevStart, prevEnd]
    ),
    query<HourRow>(
      `SELECT EXTRACT(HOUR FROM opened_at AT TIME ZONE 'UTC')::int AS hour,
              COUNT(*)::int AS opens
       FROM tracking_sessions
       WHERE NOT is_bot_or_preview AND opened_at >= $1 AND opened_at < $2
       GROUP BY hour`,
      [start, end]
    ),
    query<LinkOpensRow>(
      `SELECT link_id, COUNT(*)::int AS opens
       FROM tracking_sessions
       WHERE NOT is_bot_or_preview AND opened_at >= $1 AND opened_at < $2
       GROUP BY link_id
       ORDER BY opens DESC, link_id ASC
       LIMIT $3`,
      [start, end, TOP_LINKS]
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

  // A window that includes today runs to the end of the UTC day, not to
  // `now`: chain timestamps come from block time and can sit slightly ahead of
  // this server's clock.
  const current = chainMetrics(snapshot, window.startMs, window.endMs);
  const previous = chainMetrics(snapshot, window.prevStartMs, window.prevEndMs);

  return {
    period: window.period,
    days: window.days,
    date: window.endDate,
    startDate: window.startDate,
    endDate: window.endDate,
    generatedAt: now.toISOString(),
    hour: now.getUTCHours(),
    linksTotal: snapshot.links.length,
    linksWithOpens: Number(totals?.links_with_opens ?? 0),
    opens: delta(Number(totals?.opens ?? 0), Number(totals?.prev_opens ?? 0)),
    engagedOpens: Number(totals?.engaged ?? 0),
    wallets: delta(current.wallets, previous.wallets),
    bridgedWallets: current.bridgedWallets,
    bridgeValueUsd: delta(current.bridgeValueUsd, previous.bridgeValueUsd),
    bridgeValuePartial: current.bridgeValuePartial,
    bridgeIns: current.bridgeIns,
    actions: delta(current.actions, previous.actions),
    actionLinks: current.actionLinks,
    opensByHour,
    topLinks,
  };
};

// ---------------------------------------------------------------------------
// Breakdowns behind the snapshot tiles
// ---------------------------------------------------------------------------
// Each tile on the snapshot panel is a single number; these are the rows that
// number is made of, over the SAME window (same `period`), so a tile and its
// table can never disagree. Lists are newest-first and capped (`truncated`
// says the tail was cut) — this is a drill-down, not an export.

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

// One wallet identity that connected inside the window. The bridge/action
// figures cover that wallet's attributed events in the SAME window as the
// tiles, so a wallet that connects today and bridges tomorrow reads 0 today.
export interface WalletRow {
  address: string;
  externalWalletAddress: string | null;
  stratoAddress: string | null;
  connector: string | null;
  // Earliest connection inside the window
  connectedAt: string;
  // Open that started the session that connection happened in
  firstOpenAt: string | null;
  // firstOpenAt -> connectedAt: how long the visit took to convert
  secondsToConnect: number | null;
  // This identity's very first tracked connection, ever (not window-bound)
  firstSeenAt: string;
  // First seen before the window started: not a first-touch visitor
  returning: boolean;
  // Visits inside the window in which this wallet connected, and how many of
  // them reached the app (engagement ping)
  visits: number;
  engagedVisits: number;
  link: BreakdownLink | null;
  // Referrer of the visit that first connected this wallet in the window
  referrer: string | null;
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
  period: MetricsPeriod;
  days: number;
  date: string; // YYYY-MM-DD (UTC): the window's last day, as in the snapshot
  startDate: string;
  endDate: string;
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

// The visits a wallet connected in: enough to tell first open, engagement,
// first-touch referrer and location apart per visit
interface SessionDetailRow {
  id: string;
  opened_at: Date;
  engaged: boolean;
  referrer: string | null;
  geo_city: string | null;
  geo_country: string | null;
}

const section = <Row>(total: number, rows: Row[]): BreakdownSection<Row> => ({
  total,
  shown: rows.length,
  truncated: rows.length < total,
  rows,
});

// The window's wallet identities, keyed like the wallets tile counts them
// (walletKeyOf): the connection rows of one visitor collapse into one row.
interface WindowIdentity {
  key: string;
  addresses: Set<string>;
  externalWalletAddress: string | null;
  stratoAddress: string | null;
  connector: string | null;
  connectedAt: Date;
  // First tracked connection ever, so a wallet can be told apart from a
  // returning one even when the window only holds its latest visit
  firstSeenAt: Date;
  linkId: string;
  sessionId: string;
  // Every visit inside the window this wallet connected in
  sessionIds: Set<string>;
}

const windowIdentities = (
  snapshot: AttributionSnapshot,
  startMs: number,
  endMs: number
): WindowIdentity[] => {
  // Lifetime first-touch per identity, from the full (unwindowed) connection
  // list the snapshot already carries, ordered ascending by connected_at.
  const firstSeen = new Map<string, Date>();
  for (const conn of snapshot.connections) {
    if (conn.is_bot_or_preview) continue;
    const key = walletKeyOf(conn);
    if (!key) continue;
    const seen = firstSeen.get(key);
    if (!seen || conn.connected_at < seen) firstSeen.set(key, conn.connected_at);
  }

  const identities = new Map<string, WindowIdentity>();
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
        firstSeenAt: firstSeen.get(key) ?? conn.connected_at,
        linkId: String(conn.link_id),
        sessionId: String(conn.session_id),
        sessionIds: new Set(),
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
    identity.sessionIds.add(String(conn.session_id));
    // Earliest connection in the window owns the "link used" and the session
    if (conn.connected_at < identity.connectedAt) {
      identity.connectedAt = conn.connected_at;
      identity.linkId = String(conn.link_id);
      identity.sessionId = String(conn.session_id);
    }
  }
  return [...identities.values()];
};

// Chain events of the window, indexed by every address that identifies them,
// so a wallet row doesn't rescan the whole event list. Keyed by eventKey on
// the way out: a bridge-in matching both of a wallet's addresses counts once.
const indexByAddress = <Event extends { eventKey: string }>(
  events: Event[],
  addressesOf: (event: Event) => (string | null | undefined)[]
): Map<string, Event[]> => {
  const index = new Map<string, Event[]>();
  for (const event of events) {
    for (const address of addressesOf(event)) {
      if (!address) continue;
      const list = index.get(address);
      if (list) list.push(event);
      else index.set(address, [event]);
    }
  }
  return index;
};

const eventsFor = <Event extends { eventKey: string }>(
  index: Map<string, Event[]>,
  addresses: Set<string>
): Event[] => {
  const found = new Map<string, Event>();
  for (const address of addresses) {
    for (const event of index.get(address) ?? []) found.set(event.eventKey, event);
  }
  return [...found.values()];
};

// Rows behind all four tiles, over the same window as the snapshot.
export const getDailyBreakdown = async (
  period: MetricsPeriod = "today"
): Promise<DailyBreakdown> => {
  const now = new Date();
  const window = periodWindow(period, now);
  const { startMs, endMs } = window;
  const start = new Date(startMs);
  const end = new Date(endMs);

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
       WHERE NOT is_bot_or_preview AND opened_at >= $1 AND opened_at < $2`,
      [start, end]
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
       WHERE NOT s.is_bot_or_preview AND s.opened_at >= $1 AND s.opened_at < $2
       ORDER BY s.opened_at DESC
       LIMIT $3`,
      [start, end, MAX_ROWS]
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

  // ---- the window's attributed chain events, shared by three sections ----
  const windowBridges: BridgeInEvent[] = snapshot.bridgeIns
    .filter((b) => snapshot.assignments.has(b.eventKey) && inWindow(b.timestampMs, startMs, endMs))
    .sort((a, b) => b.timestampMs - a.timestampMs);
  const windowActions: ActivityEvent[] = snapshot.activityEvents
    .filter((e) => snapshot.assignments.has(e.eventKey) && inWindow(e.timestampMs, startMs, endMs))
    .sort((a, b) => b.timestampMs - a.timestampMs);

  // ---- wallets ----------------------------------------------------------
  const identities = windowIdentities(snapshot, startMs, endMs);
  // Every visit those wallets connected in, for first open, engagement,
  // first-touch referrer and geo
  const sessionIds = [...new Set(identities.flatMap((i) => [...i.sessionIds]))];
  const sessionsResult = sessionIds.length
    ? await query<SessionDetailRow>(
        `SELECT id, opened_at, engaged_at IS NOT NULL AS engaged, referrer, geo_city, geo_country
         FROM tracking_sessions
         WHERE id = ANY($1::uuid[])`,
        [sessionIds]
      )
    : { rows: [] as SessionDetailRow[] };
  const sessions = new Map(sessionsResult.rows.map((row) => [String(row.id), row]));
  const bridgesByAddress = indexByAddress(windowBridges, (b) => [
    b.stratoRecipient,
    b.externalSender,
  ]);
  const actionsByAddress = indexByAddress(windowActions, (e) => [e.userAddress]);

  const walletRows: WalletRow[] = identities
    .sort((a, b) => b.connectedAt.getTime() - a.connectedAt.getTime())
    .slice(0, MAX_ROWS)
    .map((identity) => {
      const bridges = eventsFor(bridgesByAddress, identity.addresses);
      const events = eventsFor(actionsByAddress, identity.addresses);
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
      const visits = [...identity.sessionIds].flatMap((id) => {
        const visit = sessions.get(id);
        return visit ? [visit] : [];
      });
      return {
        address: identity.key,
        externalWalletAddress: identity.externalWalletAddress,
        stratoAddress: identity.stratoAddress,
        connector: identity.connector,
        connectedAt: identity.connectedAt.toISOString(),
        firstOpenAt: session ? session.opened_at.toISOString() : null,
        secondsToConnect: session
          ? Math.max(
              0,
              Math.round((identity.connectedAt.getTime() - session.opened_at.getTime()) / 1000)
            )
          : null,
        firstSeenAt: identity.firstSeenAt.toISOString(),
        returning: identity.firstSeenAt.getTime() < startMs,
        visits: identity.sessionIds.size,
        engagedVisits: visits.filter((visit) => visit.engaged).length,
        link: linkRef(identity.linkId),
        referrer: session?.referrer ?? null,
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
  let bridgeValueUsd = 0;
  let bridgeValuePartial = false;
  for (const bridge of windowBridges) {
    const price = snapshot.oraclePrices.get(bridge.stratoToken);
    if (price == null) bridgeValuePartial = true;
    else bridgeValueUsd += tokenAmount(bridge.stratoTokenAmount) * price;
  }
  const bridgeRows: BridgeRow[] = windowBridges.slice(0, MAX_ROWS).map((bridge) => ({
    ...toBridgeInItem(snapshot, bridge),
    link: linkRef(snapshot.assignments.get(bridge.eventKey)?.linkId),
    chainName: externalChainName(bridge.externalChainId),
  }));

  // ---- on-chain actions -------------------------------------------------
  const groups = new Map<ActivityCategory, { count: number; wallets: Set<string>; links: Set<string> }>();
  for (const event of windowActions) {
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
  const actionRows: ActionRow[] = windowActions.slice(0, MAX_ROWS).map((event) => ({
    at: new Date(event.timestampMs).toISOString(),
    category: event.category,
    description: `${event.contractName}: ${event.eventName}`,
    address: event.userAddress,
    link: linkRef(snapshot.assignments.get(event.eventKey)?.linkId),
  }));

  return {
    period: window.period,
    days: window.days,
    date: window.endDate,
    startDate: window.startDate,
    endDate: window.endDate,
    generatedAt: now.toISOString(),
    opens: section(Number(opensCountResult.rows[0]?.opens ?? 0), openRows),
    wallets: section(identities.length, walletRows),
    bridgeIns: { ...section(windowBridges.length, bridgeRows), valueUsd: bridgeValueUsd, valuePartial: bridgeValuePartial },
    actions: { ...section(windowActions.length, actionRows), byCategory },
  };
};
