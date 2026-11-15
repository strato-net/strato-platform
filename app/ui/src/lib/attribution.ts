// Captures UTM parameters when a user lands on the platform from an external link
// (e.g. strato.nexus or a partner forwarding through it). Stored in localStorage so
// it survives the Keycloak OIDC redirect, then read after `/api/user/me` returns
// `isNewUser: true` to fire a GA4 `signup_completed` event.

const STORAGE_KEY = 'attribution';
const TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

// The cookies set here are Secure, so they only travel over https, except in
// local development over http.
const cookieAttributes = (): string => `path=/; SameSite=Lax${window.location.protocol === 'https:' ? '; Secure' : ''}`;

// The partner ref cookie.
const refCookie = (value: string, maxAge: number): string => `ref=${value}; max-age=${maxAge}; ${cookieAttributes()}`;

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

    // A partner ref link (?ref=CODE): kept in a cookie so the backend sees it
    // on the /api/user/me call that creates the account. First-touch wins.
    const ref = params.get('ref');
    if (ref && /^[A-Za-z0-9]{1,32}$/.test(ref) && !/(?:^|;\s*)ref=/.test(document.cookie)) {
      document.cookie = refCookie(ref, TTL_MS / 1000);
    }

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

// --- A guest's external wallet confirms the partner ref link it came through ---
//
// A wallet-only visitor never signs up, so the backend has no new account to
// record. The wallet signs a short message instead (free, no transaction):
// proof that the address is the visitor's, which the wallet header on a
// request is not.

const CLAIM_URL = '/api/refer/partner-claim';
// localStorage: the "<CODE>:<address>" pairs that are settled (confirmed, or
// with nothing to confirm) and are never asked about again.
const CLAIMED_KEY = 'ref_claimed';
// Session cookie (every tab, until the browser closes): the addresses whose
// wallet was already prompted, so a decline is not followed by another prompt.
const ASKED_COOKIE = 'ref_asked';

const claimedPairs = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(CLAIMED_KEY) ?? '[]');
  } catch {
    return [];
  }
};
const markClaimed = (pair: string): void => {
  try {
    localStorage.setItem(CLAIMED_KEY, JSON.stringify([...claimedPairs(), pair]));
  } catch {
    // storage unavailable: the wallet may be asked again another day
  }
};
const askedAddresses = (): string[] => new RegExp(`(?:^|;\\s*)${ASKED_COOKIE}=([0-9a-f.]*)`).exec(document.cookie)?.[1].split('.') ?? [];

// The wallets with a confirmation under way: a wallet is not asked twice at
// once, and one wallet's open prompt does not hold back another wallet's.
const claiming = new Set<string>();

// Asks the wallet at `walletAddress` to confirm the ref code in the cookie,
// once: `sign` is the wallet's personal_sign. Never throws and never blocks
// anything; a visitor who declines simply is not attributed.
export async function claimWalletReferral(walletAddress: string, sign: (message: string) => Promise<string>): Promise<void> {
  const address = walletAddress.toLowerCase().replace(/^0x/, '');
  if (claiming.has(address)) return;
  claiming.add(address);
  try {
    const code = /(?:^|;\s*)ref=([A-Za-z0-9]{1,32})(?:;|$)/.exec(document.cookie)?.[1].toUpperCase();
    if (!code) return;
    const pair = `${code}:${address}`;
    if (claimedPairs().includes(pair) || askedAddresses().includes(address)) return;

    // Plain fetch: the shared axios client sends a guest to the login page on a 401
    const headers = { 'X-Wallet-Address': address };
    const offered = await fetch(`${CLAIM_URL}?code=${code}`, { headers });
    // Referrals not set up or not reachable: asked again in a later session
    if (!offered.ok) return;
    const { message, issuedAt } = await offered.json();
    // Not a partner's code, the code owner's own wallet, or referred already
    if (!message) return markClaimed(pair);
    // Another tab may have prompted this wallet while the offer was fetched
    if (askedAddresses().includes(address)) return;

    document.cookie = `${ASKED_COOKIE}=${[...askedAddresses(), address].slice(-20).join('.')}; ${cookieAttributes()}`;
    const signature = await sign(message);
    // A contract wallet's signature is not the 65 bytes the backend can
    // check (and such a wallet cannot sign STRATO transactions): settled.
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return markClaimed(pair);
    const claimed = await fetch(CLAIM_URL, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, issuedAt, signature }),
    });
    if (claimed.ok) markClaimed(pair);
  } catch {
    // declined, unsupported by the wallet, offline: never in the visitor's way
  } finally {
    claiming.delete(address);
  }
}

export function clearAttribution(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  // On its own: storage that throws must not leave the cookie behind
  try {
    document.cookie = refCookie('', 0);
  } catch {
    // ignore
  }
}
