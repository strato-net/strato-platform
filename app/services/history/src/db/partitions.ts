import { PoolClient } from "pg";

const PARTITIONED = ["price_observations", "swaps", "balance_changes"] as const;
const known = new Set<string>();

const monthStart = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const nextMonth = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
const suffix = (d: Date): string => `y${d.getUTCFullYear()}m${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/**
 * Create the month partitions the timestamps in a batch need, once per
 * process. CREATE TABLE IF NOT EXISTS ... PARTITION OF is transactional and
 * idempotent; the indexer serialises batches, so two creators never race.
 */
export const ensurePartitions = async (client: PoolClient, timestamps: Date[]): Promise<void> => {
  const months = new Map<string, Date>();
  for (const ts of timestamps) {
    const m = monthStart(ts);
    months.set(suffix(m), m);
  }
  for (const [name, m] of months) {
    for (const table of PARTITIONED) {
      const key = `${table}_${name}`;
      if (known.has(key)) continue;
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${key} PARTITION OF ${table} FOR VALUES FROM ($1) TO ($2)`.replace(
          "FOR VALUES FROM ($1) TO ($2)",
          `FOR VALUES FROM ('${m.toISOString()}') TO ('${nextMonth(m).toISOString()}')`
        )
      );
      known.add(key);
    }
  }
};
