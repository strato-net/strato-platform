import fs from "fs";
import os from "os";

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

const busSecurity = (process.env.BUS_SECURITY || "sasl_ssl").toLowerCase();
if (!["plaintext", "ssl", "sasl_ssl"].includes(busSecurity)) {
  console.error(`Invalid BUS_SECURITY "${busSecurity}" - use plaintext, ssl or sasl_ssl`);
  process.exit(2);
}

export const config = {
  port: Number(process.env.PORT || 3030),
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
  // Live feed: the shared message bus (phase 4), topic chain_events. Empty
  // BUS_HOST disables it; the Cirrus poller alone then keeps the history
  // complete, at its polling latency.
  bus: {
    host: process.env.BUS_HOST || "",
    port: Number(process.env.BUS_PORT || 9096),
    security: busSecurity as "plaintext" | "ssl" | "sasl_ssl",
    saslUsername: process.env.BUS_SASL_USERNAME || "",
    saslPassword: process.env.BUS_SASL_PASSWORD || "",
    eventsTopic: process.env.BUS_EVENTS_TOPIC || "chain_events",
    // One group shared by every copy of this service: the topic has one
    // partition, so one copy consumes and the others stand by.
    consumerGroup: process.env.HISTORY_CONSUMER_GROUP || "history",
    clientId: `history-${os.hostname()}`,
  },
  // Backfill and completeness: Cirrus's global event table, paged by id
  // (block_number sorts as text there, so never page by it).
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

if (!config.bus.host && !config.cirrus.nodeUrl) {
  console.warn("[Config] neither BUS_HOST nor NODE_URL is set: the service will serve what it has and index nothing");
}
