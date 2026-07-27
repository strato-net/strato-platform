import { Pool } from "pg";
import { config } from "../config";

// Writable pool against the service-owned tracking DB (never cirrus, which is
// index-managed and read-only by convention).
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
