{-# LANGUAGE QuasiQuotes #-}

module Strato.Strato23.Database.Create where

import Database.PostgreSQL.Simple
import Database.PostgreSQL.Simple.SqlQQ

schemaVersionTable :: Query
schemaVersionTable =
  [sql|
CREATE TABLE IF NOT EXISTS vault_wrapper_schema_version(
  id serial PRIMARY KEY,
  schema_version int NOT NULL UNIQUE
);
|]

usersTable :: Query
usersTable =
  [sql|
CREATE TABLE IF NOT EXISTS users(
  id serial              PRIMARY KEY,
  x_user_unique_name     varchar(512) NOT NULL,
  x_identity_provider_id varchar(512) NOT NULL,
  salt bytea             NOT NULL,
  nonce bytea            NOT NULL,
  enc_sec_prv_key bytea  NOT NULL,
  address bytea          NOT NULL,
  UNIQUE (x_user_unique_name, x_identity_provider_id)
);
CREATE INDEX IF NOT EXISTS indexed_address ON users (address);
CREATE INDEX IF NOT EXISTS indexed_nameId  ON users (x_user_unique_name , x_identity_provider_id);
|]

messageTable :: Query
messageTable =
  [sql|
CREATE TABLE IF NOT EXISTS message(
  id serial PRIMARY KEY,
  salt bytea NOT NULL,
  nonce bytea NOT NULL,
  enc_msg bytea NOT NULL UNIQUE
);
|]

createTables :: Query
createTables =
  mconcat
    [ schemaVersionTable,
      usersTable,
      messageTable
    ]
