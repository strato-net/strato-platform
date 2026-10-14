import { PoolClient } from "pg";
import { query } from "../db/pool";

export interface Progress {
  name: string;
  block_number: string;
  cursor: string;
  updated_at: Date;
}

export const getProgress = async (name: string): Promise<Progress | null> => {
  const r = await query<Progress>("SELECT * FROM history_progress WHERE name = $1", [name]);
  return r.rows[0] || null;
};

export const allProgress = async (): Promise<Progress[]> =>
  (await query<Progress>("SELECT * FROM history_progress ORDER BY name")).rows;

/** Never moves backwards, so a redelivered batch cannot regress it. */
export const advanceProgress = async (
  client: PoolClient,
  name: string,
  blockNumber: number,
  cursor: number
): Promise<void> => {
  await client.query(
    `INSERT INTO history_progress (name, block_number, cursor, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (name) DO UPDATE SET
       block_number = GREATEST(history_progress.block_number, EXCLUDED.block_number),
       cursor = GREATEST(history_progress.cursor, EXCLUDED.cursor),
       updated_at = now()`,
    [name, blockNumber, cursor]
  );
};
