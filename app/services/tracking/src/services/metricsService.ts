import { query } from "../db/pool";
import {
  AttributionSnapshot,
  getSnapshot,
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
