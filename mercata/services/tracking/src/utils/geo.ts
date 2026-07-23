import geoip from "geoip-lite";
import { config } from "../config";
import { logError } from "./logger";

export interface GeoLookup {
  country: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
}

const EMPTY: GeoLookup = { country: null, city: null, lat: null, lon: null };

export const normalizeIp = (ip: string | undefined | null): string | null =>
  ip ? ip.replace(/^::ffff:/i, "").slice(0, 64) : null;

// Offline lookup from geoip-lite's bundled GeoLite2 snapshot. The snapshot is
// frozen at package publish time, so reassigned ranges (VPN endpoints
// especially) can resolve to stale countries — refresh it at image build via
// the MAXMIND_LICENSE_KEY build arg, or configure the live lookup below.
export const lookupGeoOffline = (ip: string | undefined | null): GeoLookup => {
  const normalized = normalizeIp(ip);
  if (!normalized) return EMPTY;
  try {
    const hit = geoip.lookup(normalized);
    if (!hit) return EMPTY;
    return {
      country: hit.country || null,
      city: hit.city || null,
      lat: Array.isArray(hit.ll) && Number.isFinite(hit.ll[0]) ? hit.ll[0] : null,
      lon: Array.isArray(hit.ll) && Number.isFinite(hit.ll[1]) ? hit.ll[1] : null,
    };
  } catch {
    return EMPTY;
  }
};

export const isExternalGeoConfigured = (): boolean => !!config.tracking.ipinfoToken;

// Small capped cache so repeat opens from one IP don't burn API quota
const externalCache = new Map<string, GeoLookup>();
const CACHE_MAX = 5000;

// Live lookup via ipinfo.io (always-current data). Returns null when
// unconfigured or on any failure — callers keep the offline result then.
// Never called on the redirect path directly; see the resolver's async enrich.
export const resolveGeoExternal = async (
  ip: string | undefined | null
): Promise<GeoLookup | null> => {
  const normalized = normalizeIp(ip);
  if (!normalized || !config.tracking.ipinfoToken) return null;

  const cached = externalCache.get(normalized);
  if (cached) return cached;

  try {
    const res = await fetch(
      `https://ipinfo.io/${encodeURIComponent(normalized)}?token=${config.tracking.ipinfoToken}`,
      { signal: AbortSignal.timeout(3000), headers: { Accept: "application/json" } }
    );
    if (!res.ok) throw new Error(`ipinfo responded ${res.status}`);
    const data = (await res.json()) as {
      country?: string;
      city?: string;
      loc?: string;
      bogon?: boolean;
    };
    if (data.bogon) return null; // private/reserved range
    let lat: number | null = null;
    let lon: number | null = null;
    if (typeof data.loc === "string") {
      const [rawLat, rawLon] = data.loc.split(",").map(Number);
      if (Number.isFinite(rawLat) && Number.isFinite(rawLon)) {
        lat = rawLat;
        lon = rawLon;
      }
    }
    const result: GeoLookup = {
      country: data.country ?? null,
      city: data.city ?? null,
      lat,
      lon,
    };
    if (externalCache.size >= CACHE_MAX) externalCache.clear();
    externalCache.set(normalized, result);
    return result;
  } catch (error) {
    logError("Geo", error, { operation: "resolveGeoExternal" });
    return null;
  }
};
