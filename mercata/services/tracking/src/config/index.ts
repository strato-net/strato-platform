const DB_NAME_RE = /^[a-z_][a-z0-9_]*$/;

const dbName = process.env.TRACKING_DB_NAME || "tracking";
if (!DB_NAME_RE.test(dbName)) {
  console.error(`Invalid TRACKING_DB_NAME "${dbName}" — must match ${DB_NAME_RE}`);
  process.exit(2);
}

const parseList = (raw: string | undefined): string[] =>
  (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const config = {
  port: Number(process.env.PORT || 3010),
  ssl: process.env.ssl === "true",
  api: {
    // Internal edge origin, used for anonymous Cirrus reads and /strato/v2.3/key
    nodeUrl: process.env.NODE_URL,
  },
  auth: {
    openIdDiscoveryUrl: process.env.OPENID_DISCOVERY_URL,
    // Keycloak preferred_usernames allowed to use the dashboard (sales/marketing)
    authorizedUsers: parseList(process.env.TRACKING_AUTHORIZED_USERS).map((u) => u.toLowerCase()),
  },
  db: {
    host: process.env.postgres_host || "postgres",
    port: Number(process.env.postgres_port || 5432),
    user: process.env.postgres_user || "postgres",
    password: process.env.postgres_password || "",
    database: dbName,
    // Existing DB on the shared container, used only to CREATE DATABASE
    maintenanceDb: process.env.POSTGRES_MAINTENANCE_DB || "eth",
  },
  tracking: {
    defaultDestination: process.env.TRACKING_DEFAULT_DESTINATION || "/dashboard/deposits",
    destinationAllowlist: parseList(
      process.env.TRACKING_DEST_ALLOWLIST ||
        "/dashboard/deposits,/dashboard,/dashboard/swap,/dashboard/earn,/dashboard/rewards"
    ),
    // Empty in dev → host-only cookie and relative redirects
    cookieDomain: process.env.TRACKING_COOKIE_DOMAIN || "",
    appOrigin: (process.env.TRACKING_APP_ORIGIN || "").replace(/\/$/, ""),
    attributionWindowDays: Number(process.env.TRACKING_ATTRIBUTION_WINDOW_DAYS || 90),
    cacheTtlSeconds: Number(process.env.TRACKING_CACHE_TTL_SECONDS || 60),
    cookieName: "strato_tid",
    cookieMaxAgeSeconds: 90 * 24 * 60 * 60,
  },
  cirrus: {
    contractPrefix: "BlockApps-",
    adminRegistryTable: "BlockApps-AdminRegistry-adminMap",
  },
};

const missing: string[] = [];
if (!config.api.nodeUrl) missing.push("NODE_URL");
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(2);
}

if (!config.auth.openIdDiscoveryUrl) {
  console.warn(
    "[Config] OPENID_DISCOVERY_URL not set — dashboard endpoints will reject all requests; resolver and beacons still work"
  );
}
if (config.auth.authorizedUsers.length === 0) {
  console.warn(
    "[Config] TRACKING_AUTHORIZED_USERS is empty — only on-chain admins will be able to use the dashboard"
  );
}
