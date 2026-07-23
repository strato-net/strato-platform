import geoip from "geoip-lite";

export interface GeoLookup {
  country: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
}

const EMPTY: GeoLookup = { country: null, city: null, lat: null, lon: null };

// Offline MaxMind GeoLite2 lookup (bundled with geoip-lite; city-level
// accuracy, which is all the dashboard map needs). Private/loopback ranges
// resolve to null.
export const lookupGeo = (ip: string | undefined | null): GeoLookup => {
  if (!ip) return EMPTY;
  // Express reports IPv4-mapped addresses as ::ffff:a.b.c.d
  const normalized = ip.replace(/^::ffff:/i, "");
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

export const normalizeIp = (ip: string | undefined | null): string | null =>
  ip ? ip.replace(/^::ffff:/i, "").slice(0, 64) : null;
