// Captures UTM parameters when a user lands on the platform from an external link
// (e.g. strato.nexus or a partner forwarding through it). Stored in localStorage so
// it survives the Keycloak OIDC redirect, then read after `/api/user/me` returns
// `isNewUser: true` to fire a GA4 `signup_completed` event.

const STORAGE_KEY = 'attribution';
const TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export interface AttributionData {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  via?: string;
  landing_url?: string;
  referrer?: string;
  captured_at: number;
}

// Capture utm_* / via params from the current URL into localStorage.
// First-touch wins: if a non-expired record already exists, leave it alone.
export function captureAttribution(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'via'] as const;
    const captured: Partial<AttributionData> = {};
    let hasAny = false;
    for (const key of utmKeys) {
      const value = params.get(key);
      if (value) {
        captured[key] = value;
        hasAny = true;
      }
    }
    if (!hasAny) return;

    const existing = readAttribution();
    if (existing) return; // first-touch wins

    const record: AttributionData = {
      ...captured,
      landing_url: window.location.href,
      referrer: document.referrer || undefined,
      captured_at: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // localStorage may be unavailable (private mode, quota); fail silently
  }
}

export function readAttribution(): AttributionData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AttributionData;
    if (!parsed.captured_at || Date.now() - parsed.captured_at > TTL_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearAttribution(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
