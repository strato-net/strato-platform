import { query } from "../db/pool";
import { logError } from "../utils/logger";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isValidSessionId = (id: unknown): id is string =>
  typeof id === "string" && UUID_RE.test(id);

export interface SessionGeo {
  ipAddress: string | null;
  country: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
}

// Fire-and-forget from the resolver: a DB hiccup must never delay the 302.
export const recordSessionOpen = (
  sessionId: string,
  linkId: string,
  referrer: string | null,
  userAgent: string | null,
  isBotOrPreview: boolean,
  geo: SessionGeo
): void => {
  query(
    `INSERT INTO tracking_sessions
       (id, link_id, referrer, user_agent, is_bot_or_preview,
        ip_address, geo_country, geo_city, geo_lat, geo_lon)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO NOTHING`,
    [
      sessionId,
      linkId,
      referrer,
      userAgent,
      isBotOrPreview,
      geo.ipAddress,
      geo.country,
      geo.city,
      geo.lat,
      geo.lon,
    ]
  ).catch((error) => logError("Session", error, { operation: "recordSessionOpen" }));
};

// Overrides the offline geo estimate once the live lookup lands
export const updateSessionGeo = async (
  sessionId: string,
  geo: { country: string | null; city: string | null; lat: number | null; lon: number | null }
): Promise<void> => {
  await query(
    `UPDATE tracking_sessions
     SET geo_country = $2, geo_city = $3, geo_lat = $4, geo_lon = $5
     WHERE id = $1`,
    [sessionId, geo.country, geo.city, geo.lat, geo.lon]
  );
};

export const markEngaged = async (sessionId: string): Promise<void> => {
  await query(
    "UPDATE tracking_sessions SET engaged_at = now() WHERE id = $1 AND engaged_at IS NULL",
    [sessionId]
  );
};

export const recordWalletConnection = async (
  sessionId: string,
  externalWalletAddress: string | null,
  stratoAddress: string | null,
  connector: string | null
): Promise<void> => {
  const session = await query<{ link_id: string }>(
    "SELECT link_id FROM tracking_sessions WHERE id = $1",
    [sessionId]
  );
  const linkId = session.rows[0]?.link_id;
  if (!linkId) return; // unknown/expired session: silently no-op
  await query(
    `INSERT INTO wallet_connections (session_id, link_id, external_wallet_address, strato_address, connector)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT ON CONSTRAINT wallet_connections_dedup DO NOTHING`,
    [sessionId, linkId, externalWalletAddress ?? "", stratoAddress ?? "", connector]
  );
};
