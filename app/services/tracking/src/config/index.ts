import fs from "fs";

const DB_NAME_RE = /^[a-z_][a-z0-9_]*$/;

const dbName = process.env.TRACKING_DB_NAME || "tracking";
if (!DB_NAME_RE.test(dbName)) {
  console.error(`Invalid TRACKING_DB_NAME "${dbName}" — must match ${DB_NAME_RE}`);
  process.exit(2);
}

// TLS for the Postgres connection (required by AWS RDS with force_ssl):
//   ""/disable      -> plaintext (local postgres container)
//   require/true    -> TLS without certificate verification
//   verify/verify-full -> TLS with verification; set postgres_ssl_ca to the
//                      CA bundle path (e.g. the AWS RDS global bundle)
type DbSsl = false | { rejectUnauthorized: boolean; ca?: string };
const parseDbSsl = (): DbSsl => {
  const mode = (process.env.postgres_ssl || "").trim().toLowerCase();
  if (!mode || mode === "disable" || mode === "false") return false;
  if (mode === "require" || mode === "true" || mode === "1") {
    return { rejectUnauthorized: false };
  }
  if (mode === "verify" || mode === "verify-ca" || mode === "verify-full") {
    const ssl: { rejectUnauthorized: boolean; ca?: string } = { rejectUnauthorized: true };
    const caPath = process.env.postgres_ssl_ca;
    if (caPath) {
      try {
        ssl.ca = fs.readFileSync(caPath, "utf8");
      } catch (error) {
        console.error(`Cannot read postgres_ssl_ca file "${caPath}":`, error);
        process.exit(2);
      }
    }
    return ssl;
  }
  console.error(
    `Invalid postgres_ssl "${mode}" — use disable, require, or verify-full`
  );
  process.exit(2);
};

const parseList = (raw: string | undefined): string[] =>
  (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// The tracking stack serves its own dashboard (tracking-ui container at
// /dashboard), so this service computes the chain joins itself: NODE_URL
// points at a STRATO node's public edge for anonymous Cirrus reads. Keycloak
// JWKS is the other outbound dependency (dashboard JWT verification).
export const config = {
  port: Number(process.env.PORT || 3010),
  ssl: process.env.ssl === "true",
  api: {
    // STRATO node edge for Cirrus reads, e.g. https://app.strato.nexus
    nodeUrl: (process.env.NODE_URL || "").replace(/\/$/, ""),
  },
  auth: {
    openIdDiscoveryUrl: process.env.OPENID_DISCOVERY_URL,
    // Keycloak preferred_usernames allowed to use the dashboard. The only
    // gate — there is no on-chain admin fallback here (that would need Cirrus).
    authorizedUsers: parseList(process.env.TRACKING_AUTHORIZED_USERS).map((u) => u.toLowerCase()),
  },
  db: {
    host: process.env.postgres_host || "postgres",
    port: Number(process.env.postgres_port || 5432),
    user: process.env.postgres_user || "postgres",
    password: process.env.postgres_password || "",
    database: dbName,
    ssl: parseDbSsl(),
    // Existing DB used only for CREATE DATABASE (skipped when createDatabase
    // is off — e.g. an RDS user without CREATEDB and a pre-created database)
    maintenanceDb: process.env.POSTGRES_MAINTENANCE_DB || "eth",
    createDatabase: process.env.TRACKING_DB_CREATE !== "false",
  },
  tracking: {
    defaultDestination: process.env.TRACKING_DEFAULT_DESTINATION || "/dashboard/deposits",
    // Empty in dev → host-only cookie
    cookieDomain: process.env.TRACKING_COOKIE_DOMAIN || "",
    cookieName: "strato_tid",
    cookieMaxAgeSeconds: 90 * 24 * 60 * 60,
    // ipinfo.io token for live IP geolocation (offline GeoLite2 snapshot
    // used as fallback; see utils/geo.ts)
    ipinfoToken: process.env.TRACKING_IPINFO_TOKEN || "",
    attributionWindowDays: Number(process.env.TRACKING_ATTRIBUTION_WINDOW_DAYS || 90),
    cacheTtlSeconds: Number(process.env.TRACKING_CACHE_TTL_SECONDS || 60),
  },
  // Optional origin-chain enrichment of the user timeline. Etherscan's V2 API
  // is multichain (one key serves Ethereum, Base, Polygon, … via `chainid`);
  // without a key the timeline simply omits remote-chain items.
  etherscan: {
    apiKey: process.env.TRACKING_ETHERSCAN_API_KEY || "",
    apiUrl: process.env.TRACKING_ETHERSCAN_API_URL || "https://api.etherscan.io/v2/api",
    maxTransactions: Number(process.env.TRACKING_ETHERSCAN_MAX_TX || 10),
  },
};

if (!config.api.nodeUrl) {
  console.warn(
    "[Config] NODE_URL not set — dashboard chain metrics will be empty; resolver and beacons still work"
  );
}

if (!config.auth.openIdDiscoveryUrl) {
  console.warn(
    "[Config] OPENID_DISCOVERY_URL not set — dashboard endpoints will reject all requests; resolver and beacons still work"
  );
}
if (config.auth.authorizedUsers.length === 0) {
  console.warn(
    "[Config] TRACKING_AUTHORIZED_USERS is empty — nobody can use the dashboard endpoints"
  );
}
