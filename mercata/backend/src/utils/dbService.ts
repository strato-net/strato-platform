import { Pool, PoolConfig, QueryResultRow, types } from "pg";
import { cirrusDbName } from "../config/config";

// Override pg type parsers to return raw strings instead of JS objects.
// This matches PostgREST behavior — the existing reducer code expects string timestamps
// (e.g. "2025-01-15T12:00:00") not Date objects, and numeric values as strings not floats.
types.setTypeParser(types.builtins.TIMESTAMP, (val) => val);    // 1114
types.setTypeParser(types.builtins.TIMESTAMPTZ, (val) => val);  // 1184
types.setTypeParser(types.builtins.NUMERIC, (val) => val);      // 1700

let pool: Pool | null = null;

/**
 * Initialize the Postgres connection pool for direct cirrus DB queries.
 * Reads connection config from postgres_* environment variables (same naming as other services)
 * and /run/secrets/postgres_password (exported as postgres_password in docker-run.sh).
 */
export function initDbPool(): void {
  const password = process.env.postgres_password;
  if (!password) {
    throw new Error("postgres_password is not set. Ensure postgres_password secret is mounted.");
  }

  const config: PoolConfig = {
    host: process.env.postgres_host || "postgres",
    port: parseInt(process.env.postgres_port || "5432", 10),
    user: process.env.postgres_user || "postgres",
    password,
    database: cirrusDbName,
    max: 10,
  };

  pool = new Pool(config);

  // Force all connections to read-only mode at the Postgres level
  pool.on("connect", (client) => {
    client.query("SET default_transaction_read_only = ON");
  });

  pool.on("error", (err) => {
    console.error("Unexpected error on idle DB client", err);
  });

  console.info(`DB pool initialized (host=${config.host}, db=${config.database}, pool=${config.max})`);
}

const WRITE_PATTERN = /^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)\b/i;

/** Run a read-only parameterized query and return the rows typed as T. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  if (!pool) {
    throw new Error("DB pool not initialized — call initDbPool() first");
  }
  if (WRITE_PATTERN.test(text)) {
    throw new Error("Write operations are not allowed through dbService");
  }
  const result = await pool.query<T>(text, params);
  return result.rows;
}

/** Gracefully shut down the connection pool. */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.info("DB pool closed");
  }
}
