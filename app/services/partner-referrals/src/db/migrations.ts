// Migrations are embedded as strings so the compiled dist/ needs no asset
// copying. Append new entries; never edit an applied one.

export interface Migration {
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    name: "001_init",
    sql: `
-- The Cirrus poller's position. as_of is what the metrics endpoint reports
-- as data_as_of: the block time of the last row read while behind, the
-- poll time once caught up.
CREATE TABLE progress (
  name   TEXT PRIMARY KEY,
  cursor BIGINT NOT NULL,
  as_of  TIMESTAMPTZ NOT NULL
);

-- One code per partner user, used for every campaign. The owner is the
-- partner's user id; the identifiers they shared only screen self-referrals.
CREATE TABLE codes (
  code             TEXT PRIMARY KEY,
  partner          TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  x_user_id        TEXT,
  email            TEXT,
  wallet           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (partner, external_user_id)
);

-- An account that signed up through a code's link; first code wins.
CREATE TABLE referrals (
  account    TEXT PRIMARY KEY,
  code       TEXT NOT NULL REFERENCES codes (code),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX referrals_code ON referrals (code);

-- Latest oracle price per asset as of the poller's position (USD, 1e18).
CREATE TABLE prices (
  asset TEXT PRIMARY KEY,
  price NUMERIC(78,0) NOT NULL
);

-- Pools created by a trusted factory; token0/token1 value a PoolV3 swap.
CREATE TABLE pools (
  address TEXT PRIMARY KEY,
  token0  TEXT NOT NULL,
  token1  TEXT NOT NULL
);

-- One row per counted event, valued in USD (1e18) at the oracle price when
-- it happened. Kept for good for referred accounts, and for the poller's
-- grace period for everyone else. Keyed by Cirrus event id, so a replayed
-- page counts nothing twice.
CREATE TABLE activity (
  event_id BIGINT PRIMARY KEY,
  account  TEXT NOT NULL,
  block_ts TIMESTAMPTZ NOT NULL,
  usd_wad  NUMERIC NOT NULL
);
CREATE INDEX activity_account_ts ON activity (account, block_ts);
`,
  },
  {
    name: "002_referral_counted_from",
    sql: `
-- From when a referred account's activity counts. NULL for an account a
-- signup created, which has no earlier activity. For an external wallet,
-- which can have traded before, the time it confirmed the referral.
ALTER TABLE referrals ADD COLUMN counted_from TIMESTAMPTZ;
`,
  },
];
