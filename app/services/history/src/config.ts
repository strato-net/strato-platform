import fs from "fs";

const DB_NAME_RE = /^[a-z_][a-z0-9_]*$/;

const dbName = process.env.HISTORY_DB_NAME || "history";
if (!DB_NAME_RE.test(dbName)) {
  console.error(`Invalid HISTORY_DB_NAME "${dbName}" - must match ${DB_NAME_RE}`);
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

// Price series are keyed by asset alone, so only these contracts may write
// them: the system price oracle by default. Lowercase hex, comma separated.
const priceOracles = (process.env.HISTORY_PRICE_ORACLES || "0000000000000000000000000000000000001002")
  .split(",")
  .map((a) => a.trim().toLowerCase().replace(/^0x/, ""))
  .filter((a) => a);
if (!priceOracles.every((a) => /^[0-9a-f]{40}$/.test(a))) {
  console.error(`Invalid HISTORY_PRICE_ORACLES "${process.env.HISTORY_PRICE_ORACLES}" - comma-separated 20-byte hex addresses`);
  process.exit(2);
}

export const config = {
  port: Number(process.env.PORT || 3030),
  priceOracles: new Set(priceOracles),
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
    createDatabase: process.env.HISTORY_DB_CREATE !== "false",
  },
  // The feed: Cirrus's global event table, paged by id (block_number sorts
  // as text there, so never page by it).
  cirrus: {
    nodeUrl: (process.env.NODE_URL || "").replace(/\/$/, ""),
    enabled: process.env.HISTORY_CIRRUS_POLL !== "false",
    pageSize: Number(process.env.HISTORY_CIRRUS_PAGE_SIZE || 1000),
    // Poll interval once caught up; while behind it pages continuously.
    intervalMs: Number(process.env.HISTORY_CIRRUS_INTERVAL_MS || 10000),
  },
  api: {
    // Cache-Control max-age per series resolution, seconds. CloudFront and
    // browsers honour these, so a daily chart costs one origin hit an hour.
    maxAge: {
      "1m": Number(process.env.HISTORY_MAX_AGE_1M || 30),
      "1h": Number(process.env.HISTORY_MAX_AGE_1H || 300),
      "1d": Number(process.env.HISTORY_MAX_AGE_1D || 3600),
      latest: Number(process.env.HISTORY_MAX_AGE_LATEST || 10),
    } as Record<string, number>,
    maxPoints: Number(process.env.HISTORY_MAX_POINTS || 5000),
  },
};

if (!config.cirrus.nodeUrl) {
  console.warn("[Config] NODE_URL is not set: the service will serve what it has and index nothing");
}
