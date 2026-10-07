import { PoolClient } from "pg";

const PARTITIONED = ["price_observations", "swaps", "balance_changes"] as const;
const known = new Set<string>();
// Transaction-scoped advisory lock around partition DDL: every replica runs
// its own poller, and two of them reaching a new month together could still
// collide on the catalog despite IF NOT EXISTS, rolling one batch back.
const PARTITION_LOCK_ID = 873245008;

const monthStart = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const nextMonth = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
const suffix = (d: Date): string => `y${d.getUTCFullYear()}m${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/**
 * Create the month partitions the timestamps in a batch need, once per
 * process. CREATE TABLE IF NOT EXISTS ... PARTITION OF is transactional and
 * idempotent; the indexer serialises batches within a process, and the
 * advisory lock below serialises the DDL across replicas.
 *
 * The DDL runs inside the batch's transaction, so a partition only exists
 * once that transaction commits: the returned function records the new
 * partitions as known and must be called after COMMIT (a rolled-back batch
 * leaves nothing behind, and the next attempt issues the DDL again).
 */
export const ensurePartitions = async (client: PoolClient, timestamps: Date[]): Promise<() => void> => {
  const months = new Map<string, Date>();
  for (const ts of timestamps) {
    const m = monthStart(ts);
    months.set(suffix(m), m);
  }
  const created: string[] = [];
  let locked = false;
  for (const [name, m] of months) {
    for (const table of PARTITIONED) {
      const key = `${table}_${name}`;
      if (known.has(key)) continue;
      if (!locked) {
        await client.query("SELECT pg_advisory_xact_lock($1)", [PARTITION_LOCK_ID]);
        locked = true;
      }
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${key} PARTITION OF ${table} FOR VALUES FROM ($1) TO ($2)`.replace(
          "FOR VALUES FROM ($1) TO ($2)",
          `FOR VALUES FROM ('${m.toISOString()}') TO ('${nextMonth(m).toISOString()}')`
        )
      );
      created.push(key);
    }
  }
  return () => created.forEach((key) => known.add(key));
};
