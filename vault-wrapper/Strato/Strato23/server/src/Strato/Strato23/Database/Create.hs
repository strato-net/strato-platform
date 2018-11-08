{-# LANGUAGE QuasiQuotes       #-}

module Strato.Strato23.Database.Create where

import           Database.PostgreSQL.Simple
import           Database.PostgreSQL.Simple.SqlQQ

schemaVersionTable :: Query
schemaVersionTable = [sql|
CREATE TABLE IF NOT EXISTS vault_wrapper_schema_version(
  id serial PRIMARY KEY,
  schema_version int NOT NULL UNIQUE
);
|]

usersTable :: Query
usersTable = [sql|
CREATE TABLE IF NOT EXISTS users(
  id serial PRIMARY KEY,
  x_user_unique_name varchar(512) NOT NULL UNIQUE,
  salt bytea NOT NULL,
  nonce bytea NOT NULL,
  enc_sec_key bytea NOT NULL,
  address bytea NOT NULL,
);
|]

createTables :: Query
createTables = mconcat
  [ schemaVersionTable
  , usersTable
  ]
