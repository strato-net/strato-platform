{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes       #-} 
module BlockApps.Bloc22.Database.Create where

import           Database.PostgreSQL.Simple
import           Database.PostgreSQL.Simple.SqlQQ

createDatabase :: Query
createDatabase = [sql|
CREATE DATABASE bloc22;
|]

contractsSourceTable :: Query
contractsSourceTable = [sql|
CREATE TABLE IF NOT EXISTS contracts_source(
  id serial PRIMARY KEY,
  src_hash bytea NOT NULL,
  src text NOT NULL
);
|]

evmContractNameTable :: Query
evmContractNameTable = [sql|
CREATE TABLE IF NOT EXISTS evm_contract_name(
  id serial PRIMARY KEY,
  code_hash bytea NOT NULL,
  contract_name text NOT NULL,
  src_hash bytea NOT NULL
);
|]

createTables :: Query
createTables = mconcat
  [ contractsSourceTable
  , evmContractNameTable
  ]