import { Pool, PoolClient } from "pg";
import { config } from "../config";

// Writable pool against the service-owned history DB (never cirrus or eth,
// which the node's indexers own).
export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  ssl: config.db.ssl,
  max: 10,
});

export const query = <T extends object = any>(text: string, params?: any[]) =>
  pool.query<T>(text, params);

/** Run `fn` inside one transaction; rolled back on any throw. */
export const withTransaction = async <T>(fn: (client: PoolClient) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};
