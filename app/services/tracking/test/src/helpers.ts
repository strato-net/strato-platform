// Shared plumbing for the black-box suite. Every test talks to the running
// tracking container over HTTP, to the mocks server to mint JWTs / seed Cirrus
// rows, and to Postgres directly to assert on persisted rows.
import crypto from "crypto";
import { Pool } from "pg";

export const TRACKING_URL = (process.env.TRACKING_URL || "http://localhost:3010").replace(/\/$/, "");
export const MOCKS_URL = (process.env.MOCKS_URL || "http://localhost:4100").replace(/\/$/, "");
export const AUTHORIZED_USER = process.env.AUTHORIZED_USER || "tester@example.com";
export const DEFAULT_DESTINATION = process.env.TRACKING_DEFAULT_DESTINATION || "/dashboard/deposits";

export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
export const BOT_UA = "curl/8.6.0";
// Mobile in-app browser (WhatsApp webview): carries an ambiguous token but is
// a real, JS-running browser — must be counted as a visitor.
export const IN_APP_BROWSER_UA =
  "Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 WhatsApp/2.24.6.78 A";
// The link-preview fetcher of the same app: no browser engine in the UA
export const PREVIEW_UA = "WhatsApp/2.23.20.0 A";

// Random public (documentation-range) IP so same-IP tests never collide
export const testIp = (): string =>
  `198.51.${crypto.randomInt(1, 254)}.${crypto.randomInt(1, 254)}`;

export const db = new Pool({
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "tracking",
  max: 4,
});

export const sql = <T extends object = any>(text: string, params?: any[]) => db.query<T>(text, params);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const token = async (username: string = AUTHORIZED_USER): Promise<string> => {
  const res = await fetch(`${MOCKS_URL}/__test/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  if (!res.ok) throw new Error(`token mint failed: ${res.status}`);
  return ((await res.json()) as { token: string }).token;
};

export interface ApiOptions {
  method?: string;
  body?: unknown;
  auth?: string | null; // bearer token
  headers?: Record<string, string>;
  cookie?: string | null;
}

// Redirects are never followed: the resolver's 302 is what we assert on.
export const api = async (path: string, options: ApiOptions = {}): Promise<Response> => {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.auth) headers["Authorization"] = `Bearer ${options.auth}`;
  if (options.cookie) headers["Cookie"] = options.cookie;
  return fetch(`${TRACKING_URL}${path}`, {
    method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    redirect: "manual",
  });
};

export const authed = async (path: string, options: ApiOptions = {}): Promise<Response> =>
  api(path, { ...options, auth: options.auth ?? (await token()) });

export interface CreatedLink {
  id: string;
  slug: string;
  url: string;
}

export const createLink = async (
  fields: { label?: string; source?: string; fullSource?: string; destination?: string } = {}
): Promise<CreatedLink> => {
  const res = await authed("/tracking-api/links", {
    body: { label: fields.label ?? `Test link ${crypto.randomUUID().slice(0, 8)}`, ...fields },
  });
  if (res.status !== 201) throw new Error(`createLink failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as CreatedLink;
};

// Opens the link as a browser and returns the session cookie value.
// `headers` adds request headers (e.g. X-Forwarded-For for the same-IP tests).
export const openLink = async (
  slug: string,
  userAgent: string = BROWSER_UA,
  headers: Record<string, string> = {}
): Promise<{ res: Response; cookie: string | null; sessionId: string | null }> => {
  const res = await api(`/t/${slug}`, { headers: { "User-Agent": userAgent, ...headers } });
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith("strato_tid="));
  const cookie = setCookie ? setCookie.split(";")[0] : null;
  return { res, cookie, sessionId: cookie ? cookie.split("=")[1] : null };
};

export const randomAddress = (): string => "0x" + crypto.randomBytes(20).toString("hex");
export const cirrusAddress = (address: string): string => address.toLowerCase().replace(/^0x/, "");

export const seedCirrus = async (table: string, rows: object[], replace = false): Promise<void> => {
  const res = await fetch(`${MOCKS_URL}/__test/cirrus/${encodeURIComponent(table)}`, {
    method: replace ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`seedCirrus failed: ${res.status}`);
};

export const resetCirrus = async (): Promise<void> => {
  await fetch(`${MOCKS_URL}/__test/cirrus`, { method: "DELETE" });
};

// Origin-chain transactions served by the Etherscan V2 look-alike (the
// service reads them for the user timeline when an API key is configured)
export const seedEtherscan = async (
  chainId: number,
  address: string,
  rows: object[]
): Promise<void> => {
  const res = await fetch(`${MOCKS_URL}/__test/etherscan/${chainId}/${cirrusAddress(address)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`seedEtherscan failed: ${res.status}`);
};

export const resetEtherscan = async (): Promise<void> => {
  await fetch(`${MOCKS_URL}/__test/etherscan`, { method: "DELETE" });
};

// The service answers /health before the DB and JWKS are initialized, so
// readiness = an authorized /me (JWKS init runs after bootstrapDb resolves).
export const waitForReady = async (timeoutMs = 120_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const health = await fetch(`${TRACKING_URL}/health`);
      if (health.ok) {
        const me = await api("/tracking-api/me", { auth: await token() });
        const body = (await me.json()) as { authorized?: boolean };
        if (body.authorized === true) return;
        lastError = `me=${JSON.stringify(body)}`;
      } else {
        lastError = `health=${health.status}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(1000);
  }
  throw new Error(`tracking service not ready after ${timeoutMs}ms (${lastError})`);
};

export const isoIn = (offsetMs: number): string => new Date(Date.now() + offsetMs).toISOString();
