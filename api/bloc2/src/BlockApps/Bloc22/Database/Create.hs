{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes       #-} 
module BlockApps.Bloc22.Database.Create where

import           Database.PostgreSQL.Simple
import           Database.PostgreSQL.Simple.SqlQQ

createDatabase :: Query
createDatabase = [sql|
CREATE DATABASE bloc22;
|]

usersTable :: Query
usersTable = [sql|
CREATE TABLE IF NOT EXISTS users(
  id serial PRIMARY KEY,
  name varchar(512) NOT NULL UNIQUE
);
|]

keyStoreTable :: Query
keyStoreTable = [sql|
CREATE TABLE IF NOT EXISTS keystore(
  id serial PRIMARY KEY,
  salt bytea NOT NULL,
  password_hash bytea NOT NULL,
  nonce bytea NOT NULL,
  enc_sec_key bytea NOT NULL,
  pub_key bytea NOT NULL,
  address bytea NOT NULL UNIQUE,
  user_id int NOT NULL REFERENCES users(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
|]

contractsTable :: Query
contractsTable = [sql|
CREATE TABLE IF NOT EXISTS contracts(
  id serial PRIMARY KEY,
  name varchar(512) NOT NULL UNIQUE
);
|]

contractsSourceTable :: Query
contractsSourceTable = [sql|
CREATE TABLE IF NOT EXISTS contracts_source(
  id serial PRIMARY KEY,
  src_hash bytea NOT NULL,
  src text NOT NULL
);
|]

contractsMetaDataTable :: Query
contractsMetaDataTable = [sql|
CREATE TABLE IF NOT EXISTS contracts_metadata(
  id serial PRIMARY KEY,
  contract_id int NOT NULL REFERENCES contracts(id),
  bin bytea NOT NULL,
  bin_runtime bytea NOT NULL,
  code_hash bytea NOT NULL,
  xcode_hash bytea NOT NULL,
  src_hash bytea NOT NULL,
  xabi bytea NOT NULL,
  FOREIGN KEY (contract_id) REFERENCES contracts(id),
  CONSTRAINT uc_contracts_metadata UNIQUE (code_hash, src_hash)
);
|]

hashNameTable :: Query
hashNameTable = [sql|
CREATE TABLE IF NOT EXISTS hash_name(
  id serial PRIMARY KEY,
  hash bytea NOT NULL,
  contract_metadata_id int NOT NULL,
  transaction_type int NOT NULL,
  data_string text
);
|]

contractsInstanceTable :: Query
contractsInstanceTable = [sql|
CREATE TABLE IF NOT EXISTS contracts_instance(
  id serial PRIMARY KEY,
  contract_metadata_id int NOT NULL REFERENCES contracts_metadata(id),
  address bytea NOT NULL,
  timestamp timestamptz NOT NULL DEFAULT now(),
  chainid bytea NOT NULL,
  FOREIGN KEY (contract_metadata_id) REFERENCES contracts_metadata(id)
);
|]

createTables :: Query
createTables = mconcat
  [ usersTable
  , keyStoreTable
  , contractsTable
  , contractsSourceTable
  , contractsMetaDataTable
  , hashNameTable
  , contractsInstanceTable
  ]
