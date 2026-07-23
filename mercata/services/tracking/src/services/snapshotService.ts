import { query } from "../db/pool";
import { listLinks, publicUrlForSlug } from "./linkService";

// The offchain snapshot consumed by the mercata backend's attribution engine.
// This service owns no chain data: everything here comes from the tracking DB.

export interface SnapshotLink {
  id: string;
  slug: string;
  url: string;
  label: string;
  source: string | null;
  createdBy: string;
  destination: string;
  active: boolean;
  createdAt: string;
}

export interface SnapshotConnection {
  id: string;
  sessionId: string;
  linkId: string;
  externalWalletAddress: string | null;
  stratoAddress: string | null;
  connector: string | null;
  connectedAt: string;
  isBotOrPreview: boolean;
}

export interface SnapshotSessionStats {
  linkId: string;
  opens: number;
  engagedOpens: number;
  botOpens: number;
  lastOpenedAt: string | null;
}

export interface SnapshotGeoPoint {
  linkId: string;
  lat: number;
  lon: number;
  city: string | null;
  country: string | null;
  count: number;
}

export interface OffchainSnapshot {
  links: SnapshotLink[];
  connections: SnapshotConnection[];
  sessionStats: SnapshotSessionStats[];
  geoPoints: SnapshotGeoPoint[];
}

export const getOffchainSnapshot = async (): Promise<OffchainSnapshot> => {
  const links = (await listLinks()).map((link) => ({
    id: String(link.id),
    slug: link.slug,
    url: publicUrlForSlug(link.slug),
    label: link.label,
    source: link.source,
    createdBy: link.created_by,
    destination: link.destination,
    active: link.active,
    createdAt: link.created_at.toISOString(),
  }));

  const connectionsResult = await query<{
    id: string;
    session_id: string;
    link_id: string;
    external_wallet_address: string;
    strato_address: string;
    connector: string | null;
    connected_at: Date;
    is_bot_or_preview: boolean;
  }>(
    `SELECT wc.id, wc.session_id, wc.link_id, wc.external_wallet_address,
            wc.strato_address, wc.connector, wc.connected_at, ts.is_bot_or_preview
     FROM wallet_connections wc
     JOIN tracking_sessions ts ON ts.id = wc.session_id
     ORDER BY wc.connected_at ASC`
  );
  const connections = connectionsResult.rows.map((row) => ({
    id: String(row.id),
    sessionId: row.session_id,
    linkId: String(row.link_id),
    externalWalletAddress: row.external_wallet_address || null,
    stratoAddress: row.strato_address || null,
    connector: row.connector,
    connectedAt: row.connected_at.toISOString(),
    isBotOrPreview: row.is_bot_or_preview,
  }));

  const statsResult = await query<{
    link_id: string;
    opens: string;
    engaged_opens: string;
    bot_opens: string;
    last_opened_at: Date | null;
  }>(
    `SELECT link_id,
            COUNT(*) FILTER (WHERE NOT is_bot_or_preview) AS opens,
            COUNT(*) FILTER (WHERE engaged_at IS NOT NULL) AS engaged_opens,
            COUNT(*) FILTER (WHERE is_bot_or_preview) AS bot_opens,
            MAX(opened_at) AS last_opened_at
     FROM tracking_sessions
     GROUP BY link_id`
  );
  const sessionStats = statsResult.rows.map((row) => ({
    linkId: String(row.link_id),
    opens: Number(row.opens),
    engagedOpens: Number(row.engaged_opens),
    botOpens: Number(row.bot_opens),
    lastOpenedAt: row.last_opened_at ? new Date(row.last_opened_at).toISOString() : null,
  }));

  const geoResult = await query<{
    link_id: string;
    geo_lat: number;
    geo_lon: number;
    geo_city: string | null;
    geo_country: string | null;
    count: string;
  }>(
    `SELECT link_id, geo_lat, geo_lon, geo_city, geo_country, COUNT(*) AS count
     FROM tracking_sessions
     WHERE NOT is_bot_or_preview AND geo_lat IS NOT NULL AND geo_lon IS NOT NULL
     GROUP BY link_id, geo_lat, geo_lon, geo_city, geo_country`
  );
  const geoPoints = geoResult.rows.map((row) => ({
    linkId: String(row.link_id),
    lat: row.geo_lat,
    lon: row.geo_lon,
    city: row.geo_city,
    country: row.geo_country,
    count: Number(row.count),
  }));

  return { links, connections, sessionStats, geoPoints };
};
