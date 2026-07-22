// Migrations are embedded as strings (not .sql files) so the compiled dist/
// needs no asset copying. Append new entries; never edit an applied one.

export interface Migration {
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    name: "001_init",
    sql: `
CREATE TABLE tracking_links (
  id           BIGSERIAL PRIMARY KEY,
  slug         TEXT        NOT NULL UNIQUE,
  label        TEXT        NOT NULL,
  source       TEXT,
  created_by   TEXT        NOT NULL,
  destination  TEXT        NOT NULL DEFAULT '/dashboard/deposits',
  active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tracking_sessions (
  id                UUID        PRIMARY KEY,
  link_id           BIGINT      NOT NULL REFERENCES tracking_links(id),
  opened_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  engaged_at        TIMESTAMPTZ,
  referrer          TEXT,
  user_agent        TEXT,
  is_bot_or_preview BOOLEAN     NOT NULL DEFAULT FALSE
);
CREATE INDEX tracking_sessions_link_opened_idx ON tracking_sessions (link_id, opened_at);

CREATE TABLE wallet_connections (
  id                      BIGSERIAL   PRIMARY KEY,
  session_id              UUID        NOT NULL REFERENCES tracking_sessions(id),
  link_id                 BIGINT      NOT NULL REFERENCES tracking_links(id),
  external_wallet_address TEXT        NOT NULL DEFAULT '',
  strato_address          TEXT        NOT NULL DEFAULT '',
  connector               TEXT,
  connected_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT wallet_connections_has_address
    CHECK (external_wallet_address <> '' OR strato_address <> ''),
  CONSTRAINT wallet_connections_dedup
    UNIQUE (session_id, external_wallet_address, strato_address)
);
CREATE INDEX wallet_connections_ext_addr_idx
  ON wallet_connections (external_wallet_address) WHERE external_wallet_address <> '';
CREATE INDEX wallet_connections_strato_addr_idx
  ON wallet_connections (strato_address) WHERE strato_address <> '';
CREATE INDEX wallet_connections_link_idx ON wallet_connections (link_id, connected_at);
`,
  },
];
