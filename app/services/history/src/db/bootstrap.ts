import { Client } from "pg";
import { config } from "../config";
import { logInfo } from "../utils/logger";
import { pool } from "./pool";
import { migrations } from "./migrations";

const MIGRATION_LOCK_ID = 873245007;
const DUPLICATE_DATABASE = "42P04";

// CREATE DATABASE cannot run inside a transaction and must target an existing
// DB, so this connects to the maintenance DB first.
const createDatabaseIfMissing = async (): Promise<void> => {
  const client = new Client({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.maintenanceDb,
    ssl: config.db.ssl,
  });
  await client.connect();
  try {
    const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [config.db.database]);
    if (existing.rowCount === 0) {
      try {
        // Identifier validated against /^[a-z_][a-z0-9_]*$/ in config
        await client.query(`CREATE DATABASE ${config.db.database}`);
        logInfo("DB", `Created database ${config.db.database}`);
      } catch (error: any) {
        if (error?.code !== DUPLICATE_DATABASE) throw error; // lost a race: fine
      }
    }
  } finally {
    await client.end();
  }
};

const runMigrations = async (): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
    );
    const applied = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    for (const migration of migrations) {
      if (applied.has(migration.name)) continue;
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [migration.name]);
        await client.query("COMMIT");
        logInfo("DB", `Applied migration ${migration.name}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => undefined);
    client.release();
  }
};

export const bootstrapDb = async (): Promise<void> => {
  if (config.db.createDatabase) await createDatabaseIfMissing();
  await runMigrations();
  logInfo("DB", `Ready: ${config.db.database}@${config.db.host}`);
};
