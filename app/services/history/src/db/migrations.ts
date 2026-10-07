// Migrations are embedded as strings so the compiled dist/ needs no asset
// copying. Append new entries; never edit an applied one.

export interface Migration {
  name: string;
  sql: string;
}

// Amounts are NUMERIC(78,0): a uint256 has at most 78 decimal digits.
// (002 widens the derived columns and the ordering key; see there.)
// The raw-event tables are partitioned by month on block_ts (which therefore
// belongs to every primary key); partitions are created on demand by the
// indexer (see partitions.ts). Plain Postgres partitioning: TimescaleDB is
// not available on RDS.
export const migrations: Migration[] = [
  {
    name: "001_init",
    sql: `
CREATE TABLE history_progress (
  name         TEXT PRIMARY KEY,
  block_number BIGINT NOT NULL DEFAULT 0,
  cursor       BIGINT NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per (oracle, asset, event); PriceUpdated and each element of a
-- BatchPricesUpdated. ord orders observations within the chain
-- (block, event index, element) independent of arrival order.
CREATE TABLE price_observations (
  oracle       TEXT NOT NULL,
  asset        TEXT NOT NULL,
  block_number BIGINT NOT NULL,
  block_ts     TIMESTAMPTZ NOT NULL,
  ord          BIGINT NOT NULL,
  tx_hash      TEXT,
  price        NUMERIC(78,0) NOT NULL,
  PRIMARY KEY (oracle, asset, ord, block_ts)
) PARTITION BY RANGE (block_ts);
CREATE INDEX price_observations_asset_ts ON price_observations (asset, block_ts);

CREATE TABLE swaps (
  pool         TEXT NOT NULL,
  block_number BIGINT NOT NULL,
  block_ts     TIMESTAMPTZ NOT NULL,
  ord          BIGINT NOT NULL,
  tx_hash      TEXT,
  sender       TEXT,
  token_in     TEXT NOT NULL,
  token_out    TEXT NOT NULL,
  amount_in    NUMERIC(78,0) NOT NULL,
  amount_out   NUMERIC(78,0) NOT NULL,
  PRIMARY KEY (pool, ord, block_ts)
) PARTITION BY RANGE (block_ts);
CREATE INDEX swaps_pool_ts ON swaps (pool, block_ts);

-- Change log: two rows per Transfer (the sender's debit, the receiver's
-- credit). Sums are order independent, which is what lets the bus feed and
-- the Cirrus poller both write without coordinating.
CREATE TABLE balance_changes (
  token        TEXT NOT NULL,
  account      TEXT NOT NULL,
  block_number BIGINT NOT NULL,
  block_ts     TIMESTAMPTZ NOT NULL,
  ord          BIGINT NOT NULL,
  leg          SMALLINT NOT NULL,
  tx_hash      TEXT,
  delta        NUMERIC(78,0) NOT NULL,
  PRIMARY KEY (token, ord, leg, block_ts)
) PARTITION BY RANGE (block_ts);
CREATE INDEX balance_changes_account_ts ON balance_changes (token, account, block_ts);

CREATE TABLE balances_current (
  token   TEXT NOT NULL,
  account TEXT NOT NULL,
  balance NUMERIC(78,0) NOT NULL,
  PRIMARY KEY (token, account)
);

-- End-of-day balance for every day the account had a change; the API
-- carries the last value forward over quiet days.
CREATE TABLE balance_snapshots_daily (
  token   TEXT NOT NULL,
  account TEXT NOT NULL,
  day     DATE NOT NULL,
  balance NUMERIC(78,0) NOT NULL,
  PRIMARY KEY (token, account, day)
);

-- Pre-aggregated candles per series and resolution. first_ord/last_ord make
-- open and close order independent; volume and count only ever advance
-- from observations that were actually new (see apply.ts).
CREATE TABLE ohlc (
  series     TEXT NOT NULL,
  resolution TEXT NOT NULL,
  bucket     TIMESTAMPTZ NOT NULL,
  open       NUMERIC(78,18) NOT NULL,
  high       NUMERIC(78,18) NOT NULL,
  low        NUMERIC(78,18) NOT NULL,
  close      NUMERIC(78,18) NOT NULL,
  volume     NUMERIC(78,0) NOT NULL DEFAULT 0,
  count      INTEGER NOT NULL DEFAULT 0,
  first_ord  BIGINT NOT NULL,
  last_ord   BIGINT NOT NULL,
  PRIMARY KEY (series, resolution, bucket)
);
`,
  },
  {
    // The ordering key became block << 64 | event << 32 | element (see
    // normalize.ts), which needs more than a BIGINT; sums over events
    // (balances, candle volume) can exceed one uint256 and candle prices
    // need 78 integer digits plus 18 decimals. Rows written before this
    // migration keep their old (smaller) ord values, which still sort before
    // every new one; but an event from before the upgrade that a feed
    // replays afterwards gets a new key and is counted again, so a database
    // that was indexing under the old key is better dropped and reindexed
    // than migrated.
    name: "002_wide_numerics",
    sql: `
ALTER TABLE price_observations ALTER COLUMN ord TYPE NUMERIC(40,0);
ALTER TABLE swaps ALTER COLUMN ord TYPE NUMERIC(40,0);
ALTER TABLE balance_changes ALTER COLUMN ord TYPE NUMERIC(40,0);
ALTER TABLE balances_current ALTER COLUMN balance TYPE NUMERIC;
ALTER TABLE balance_snapshots_daily ALTER COLUMN balance TYPE NUMERIC;
ALTER TABLE ohlc
  ALTER COLUMN open TYPE NUMERIC(96,18),
  ALTER COLUMN high TYPE NUMERIC(96,18),
  ALTER COLUMN low TYPE NUMERIC(96,18),
  ALTER COLUMN close TYPE NUMERIC(96,18),
  ALTER COLUMN volume TYPE NUMERIC,
  ALTER COLUMN first_ord TYPE NUMERIC(40,0),
  ALTER COLUMN last_ord TYPE NUMERIC(40,0);
`,
  },
];
