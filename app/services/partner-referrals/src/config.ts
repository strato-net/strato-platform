import fs from "fs";

const DB_NAME_RE = /^[a-z_][a-z0-9_]*$/;

const dbName = process.env.PARTNER_REFERRALS_DB_NAME || "partner_referrals";
if (!DB_NAME_RE.test(dbName)) {
  console.error(`Invalid PARTNER_REFERRALS_DB_NAME "${dbName}" - must match ${DB_NAME_RE}`);
  process.exit(2);
}

// TLS for the Postgres connection (required by AWS RDS with force_ssl):
//   ""/disable         -> plaintext (local postgres container)
//   require/true       -> TLS without certificate verification
//   verify/verify-full -> TLS with verification; postgres_ssl_ca is the CA bundle
type DbSsl = false | { rejectUnauthorized: boolean; ca?: string };
const parseDbSsl = (): DbSsl => {
  const mode = (process.env.postgres_ssl || "").trim().toLowerCase();
  if (!mode || mode === "disable" || mode === "false") return false;
  if (mode === "require" || mode === "true" || mode === "1") return { rejectUnauthorized: false };
  if (mode === "verify" || mode === "verify-ca" || mode === "verify-full") {
    const ssl: { rejectUnauthorized: boolean; ca?: string } = { rejectUnauthorized: true };
    const caPath = process.env.postgres_ssl_ca;
    if (caPath) ssl.ca = fs.readFileSync(caPath, "utf8");
    return ssl;
  }
  console.error(`Invalid postgres_ssl "${mode}" - use disable, require, or verify-full`);
  process.exit(2);
};

// Lowercase 20-byte hex addresses, comma separated. Event names collide
// across contracts, so activity and prices are only ever read from these.
const addresses = (name: string, fallback: string): string[] => {
  const list = (process.env[name] ?? fallback)
    .split(",")
    .map((a) => a.trim().toLowerCase().replace(/^0x/, ""))
    .filter((a) => a);
  if (!list.every((a) => /^[0-9a-f]{40}$/.test(a))) {
    console.error(`Invalid ${name} "${process.env[name]}" - comma-separated 20-byte hex addresses`);
    process.exit(2);
  }
  return list;
};

// A bearer key is the only thing between a caller and a partner's data, so
// it has to be too long to guess: 32+ characters of a random generator.
const MIN_KEY_LENGTH = 32;

// PARTNER_API_KEYS is "partner:key,partner:key" (a staging and a production
// key are two entries under two partner names), held as key -> partner.
const apiKeys = new Map<string, string>();
for (const entry of (process.env.PARTNER_API_KEYS || "").split(",").map((e) => e.trim()).filter((e) => e)) {
  const sep = entry.indexOf(":");
  const [partner, key] = [entry.slice(0, sep), entry.slice(sep + 1)];
  if (sep < 1 || key.length < MIN_KEY_LENGTH || apiKeys.has(key)) {
    console.error(`Invalid PARTNER_API_KEYS - expected "partner:key,partner:key" with distinct keys of ${MIN_KEY_LENGTH}+ characters`);
    process.exit(2);
  }
  apiKeys.set(key, partner);
}

const internalKey = process.env.PARTNER_INTERNAL_KEY || "";
if (internalKey && (internalKey.length < MIN_KEY_LENGTH || apiKeys.has(internalKey))) {
  console.error(`Invalid PARTNER_INTERNAL_KEY - ${MIN_KEY_LENGTH}+ characters, and not one of the partner keys`);
  process.exit(2);
}

export const config = {
  port: Number(process.env.PORT || 3040),
  apiKeys,
  // Bearer the app backend presents to record a referred signup.
  internalKey,
  // The app's public URL; a code's ref_link is `${refLinkBase}?ref=<code>`.
  // Left unset, no ref_link is returned and the partner builds the link.
  refLinkBase: process.env.PARTNER_REF_LINK_BASE || "",
  sources: {
    priceOracles: new Set(addresses("PRICE_ORACLE", "0000000000000000000000000000000000001002")),
    // PoolFactory and PoolV3Factory: their NewPool / NewPoolV3 events name the pools whose swaps count.
    poolFactories: new Set(addresses("PARTNER_POOL_FACTORIES", "000000000000000000000000000000000000100a")),
    lendingPools: new Set(addresses("LENDING_POOL", "0000000000000000000000000000000000001005")),
    bridges: new Set(addresses("MERCATA_BRIDGE", "0000000000000000000000000000000000001008")),
    cdpEngines: new Set(addresses("CDP_ENGINE", "0000000000000000000000000000000000001011")),
    // Network specific, no default: metal purchases are not counted while unset.
    metalForges: new Set(addresses("METAL_FORGE", "")),
  },
  db: {
    host: process.env.postgres_host || "postgres",
    port: Number(process.env.postgres_port || 5432),
    user: process.env.postgres_user || "postgres",
    password: process.env.postgres_password || "",
    database: dbName,
    ssl: parseDbSsl(),
    // Existing DB used only for CREATE DATABASE (skipped when createDatabase
    // is off, e.g. an RDS user without CREATEDB and a pre-created database)
    maintenanceDb: process.env.POSTGRES_MAINTENANCE_DB || "postgres",
    createDatabase: process.env.PARTNER_REFERRALS_DB_CREATE !== "false",
  },
  // The feed: Cirrus's global event table, paged by id.
  cirrus: {
    nodeUrl: (process.env.NODE_URL || "").replace(/\/$/, ""),
    pageSize: Number(process.env.PARTNER_CIRRUS_PAGE_SIZE || 1000),
    // Poll interval once caught up; while behind it pages continuously.
    intervalMs: Number(process.env.PARTNER_CIRRUS_INTERVAL_MS || 10000),
  },
};

if (!config.cirrus.nodeUrl) {
  console.warn("[Config] NODE_URL is not set: codes are issued but no activity is indexed");
}
if (apiKeys.size === 0) {
  console.warn("[Config] PARTNER_API_KEYS is not set: every partner request is refused");
}
if (!internalKey) {
  console.warn("[Config] PARTNER_INTERNAL_KEY is not set: no signup is recorded");
}
