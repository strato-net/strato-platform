{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes       #-} 
module BlockApps.Bloc22.Database.Create where

import           Database.PostgreSQL.Simple
import           Database.PostgreSQL.Simple.SqlQQ

createDatabase :: Query
createDatabase = [sql|
CREATE DATABASE bloc22;
|]

schemaVersionTable :: Query
schemaVersionTable = [sql|
CREATE TABLE IF NOT EXISTS bloc_schema_version(
  id serial PRIMARY KEY,
  schema_version int NOT NULL UNIQUE
);
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
  data_string text NOT NULL
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

xabiFunctionsTable :: Query
xabiFunctionsTable = [sql|
CREATE TABLE IF NOT EXISTS xabi_functions(
  id serial PRIMARY KEY,
  contract_metadata_id int NOT NULL REFERENCES contracts_metadata(id),
  is_constructor boolean NOT NULL,
  name varchar(512) NOT NULL,
  mutability varchar(20),
  UNIQUE (contract_metadata_id, name),
  FOREIGN KEY (contract_metadata_id) REFERENCES contracts_metadata(id)
);
|]

xabiTypesTable :: Query
xabiTypesTable = [sql|
CREATE TABLE IF NOT EXISTS xabi_types(
  id serial PRIMARY KEY,
  type varchar(50) NOT NULL,
  typedef varchar(512),
  is_dynamic boolean NOT NULL,
  is_signed boolean NOT NULL,
  bytes int NULL,
  length int NULL,
  entry_type_id int REFERENCES xabi_types(id),
  value_type_id int REFERENCES xabi_types(id),
  key_type_id int REFERENCES xabi_types(id),
  FOREIGN KEY (entry_type_id) REFERENCES xabi_types(id),
  FOREIGN KEY (value_type_id) REFERENCES xabi_types(id),
  FOREIGN KEY (key_type_id) REFERENCES xabi_types(id)
);
|]

xabiFunctionArgumentsTable :: Query
xabiFunctionArgumentsTable = [sql|
CREATE TABLE IF NOT EXISTS xabi_function_arguments(
  id serial PRIMARY KEY,
  function_id int NOT NULL REFERENCES xabi_functions(id),
  type_id int NOT NULL REFERENCES xabi_types(id),
  name varchar(512) NOT NULL,
  index int NOT NULL,
  FOREIGN KEY (function_id) REFERENCES xabi_functions(id),
  FOREIGN KEY (type_id) REFERENCES xabi_types(id)
);
|]

xabiFunctionReturnsTable :: Query
xabiFunctionReturnsTable = [sql|
CREATE TABLE IF NOT EXISTS xabi_function_returns(
  id serial PRIMARY KEY,
  function_id int NOT NULL REFERENCES xabi_functions(id),
  index int NOT NULL,
  type_id int NOT NULL REFERENCES xabi_types(id),
  FOREIGN KEY (function_id) REFERENCES xabi_functions(id),
  FOREIGN KEY (type_id) REFERENCES xabi_types(id)
);
|]

xabiVariablesTable :: Query
xabiVariablesTable = [sql|
CREATE TABLE IF NOT EXISTS xabi_variables(
  id serial PRIMARY KEY,
  contract_metadata_id int NOT NULL REFERENCES contracts_metadata(id),
  type_id int NOT NULL REFERENCES xabi_types(id),
  name varchar(512) NOT NULL,
  at_bytes int NOT NULL,
  is_public boolean NOT NULL,
  is_constant boolean default FALSE,
  value text,
  UNIQUE (contract_metadata_id, name),
  FOREIGN KEY (contract_metadata_id) REFERENCES contracts_metadata(id),
  FOREIGN KEY (type_id) REFERENCES xabi_types(id)
);
|]

xabiTypeDefsTables :: Query
xabiTypeDefsTables = [sql|
CREATE TABLE IF NOT EXISTS xabi_type_defs(
  id serial PRIMARY KEY,
  name varchar(512) NOT NULL,
  contract_metadata_id int NOT NULL REFERENCES contracts_metadata(id),
  type varchar(50) NOT NULL,
  bytes INT NOT NULL,
  FOREIGN KEY (contract_metadata_id) REFERENCES contracts_metadata(id)
);
|]

xabiEnumNamesTable :: Query
xabiEnumNamesTable = [sql|
CREATE TABLE IF NOT EXISTS xabi_enum_names(
  id serial PRIMARY KEY,
  name varchar(512) NOT NULL,
  value int NOT NULL,
  type_def_id int NOT NULL REFERENCES xabi_type_defs(id),
  FOREIGN KEY (type_def_id) REFERENCES xabi_type_defs(id)
);
|]

xabiStructFieldsTable :: Query
xabiStructFieldsTable = [sql|
CREATE TABLE IF NOT EXISTS xabi_struct_fields(
  id serial PRIMARY KEY,
  name varchar(512) NOT NULL,
  at_bytes int NOT NULL,
  type_def_id int NOT NULL REFERENCES xabi_type_defs(id),
  field_type_id int NOT NULL REFERENCES xabi_types(id),
  FOREIGN KEY (type_def_id) REFERENCES xabi_type_defs(id),
  FOREIGN KEY (field_type_id) REFERENCES xabi_types(id)
);
|]

createTables :: Query
createTables = mconcat
  [ schemaVersionTable
  , usersTable
  , keyStoreTable
  , contractsTable
  , contractsSourceTable
  , contractsMetaDataTable
  , hashNameTable
  , contractsInstanceTable
  , xabiFunctionsTable
  , xabiTypesTable
  , xabiFunctionArgumentsTable
  , xabiFunctionReturnsTable
  , xabiVariablesTable
  , xabiTypeDefsTables
  , xabiEnumNamesTable
  , xabiStructFieldsTable
  ]
