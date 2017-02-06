{-# LANGUAGE
    OverloadedStrings
#-}

module BlockApps.Bloc.Database where

import Data.ByteString (ByteString)

usersTable :: ByteString
usersTable =
  "CREATE TABLE users(\
    \id serial PRIMARY KEY,\
    \name varchar (512) NOT NULL UNIQUE,\
    \password_hash bytea NOT NULL\
  \);"

addressesTable :: ByteString
addressesTable =
  "CREATE TABLE addresses(\
    \id serial PRIMARY KEY,\
    \address bytea NOT NULL UNIQUE,\
    \user_id NOT NULL REFERENCES users(id),\
    \FOREIGN KEY (user_id) REFERENCES users(id)\
  \);"

contractsTable :: ByteString
contractsTable =
  "CREATE TABLE contracts(\
    \id serial PRIMARY KEY,\
    \name varchar (512) NOT NULL UNIQUE\
  \);"

contractsMetaDataTable :: ByteString
contractsMetaDataTable =
  "CREATE TABLE contracts_metadata(\
    \id serial PRIMARY KEY,\
    \contract_id NOT NULL REFERENCES contracts(id),\
    \bin bytea NOT NULL,\
    \bin_runtime bytea NOT NULL,\
    \bin_runtime_hash NOT NULL,\
    \code_hash bytea NOT NULL,\
    \UNIQUE (bin_runtime_hash, code_hash),\
    \FOREIGN KEY (contract_id) REFERENCES contracts(id)\
  \);"

contractsInstanceTable :: ByteString
contractsInstanceTable =
  "CREATE TABLE contracts_instance(\
    \id serial PRIMARY KEY,\
    \contract_metadata_id NOT NULL REFERENCES contracts_metadata(id),\
    \address bytea NOT NULL UNIQUE,\
    \timestamp timestamptz NOT NULL,\
    \FOREIGN KEY (contract_metadata_id) REFERENCES contracts_metadata(id)\
  \);"

contractsLookupTable :: ByteString
contractsLookupTable =
  "CREATE TABLE contracts_lookup(\
    \contract_metadata_id NOT NULL REFERENCES contracts_metadata(id),\
    \linked_metadata_id NOT NULL REFERENCES contracts_metadata(id),\
    \PRIMARY KEY (contract_metadata_id, linked_metadata_id),\
    \FOREIGN KEY (contract_metadata_id) REFERENCES contracts_metadata(id),\
    \FOREIGN KEY (linked_metadata_id) REFERENCES contracts_metadata(id)\
  \);"

xabiFunctionsTable :: ByteString
xabiFunctionsTable =
  "CREATE TABLE xabi_functions(\
    \id serial PRIMARY KEY,\
    \contract_metadata_id NOT NULL REFERENCES contracts_metadata(id),\
    \is_constructor boolean NOT NULL,\
    \name varchar(512),\
    \selector bytea,\
    \FOREIGN KEY (contract_metadata_id) REFERENCES contracts_metatdata(id)\
  \);"

xabiFunctionArgumentsTable :: ByteString
xabiFunctionArgumentsTable =
  "CREATE TABLE xabi_function_arguments(\
    \id serial PRIMARY KEY,\
    \function_id NOT NULL REFERENCES xabi_functions(id),\
    \type_id NOT NULL REFERENCES xabi_types(id),\
    \name varchar(512) NOT NULL,\
    \index integer NOT NULL,\
    \FOREIGN KEY (function_id) REFERENCES xabi_functions(id),\
    \FOREIGN KEY (type_id) REFERENCES xabi_types(id)\
  \);"

xabiFunctionReturnsTable :: ByteString
xabiFunctionReturnsTable =
  "CREATE TABLE xabi_function_returns(\
    \id serial PRIMARY KEY,\
    \function_id NOT NULL REFERENCES xabi_functions(id),\
    \index integer NOT NULL,\
    \type_id NOT NULL REFERENCES xabi_types(id),\
    \FOREIGN KEY (function_id) REFERENCES xabi_functions(id),\
    \FOREIGN KEY (type_id) REFERENCES xabi_types(id)\
  \);"

xabiTypesTable :: ByteString
xabiTypesTable =
  "CREATE TABLE xabi_types(\
    \id serial PRIMARY KEY,\
    \type varchar(50) NOT NULL,\
    \typedef varchar(512),\
    \is_dynamic boolean NOT NULL,\
    \is_signed boolean NOT NULL,\
    \is_public boolean NOT NULL,\
    \bytes integer NULL,\
    \entry_type_id REFERENCES xabi_types(id),\
    \value_type_id REFERENCES xabi_types(id),\
    \key_type_id REFERENCES xabi_types(id),\
    \FOREIGN KEY (entry_type_id) REFERENCES xabi_types(id),\
    \FOREIGN KEY (value_type_id) REFERENCES xabi_types(id),\
    \FOREIGN KEY (key_type_id) REFERENCES xabi_types(id)\
  \);"


xabiVariablesTable :: ByteString
xabiVariablesTable =
  "CREATE TABLE xabi_variables(\
    \id serial PRIMARY KEY,\
    \contract_metadata_id NOT NULL REFERENCES contracts_metadata(id),\
    \type_id NOT NULL REFERENCES xabi_types(id),\
    \name varchar(512) NOT NULL,\
    \at_bytes integer NOT NULL,\
    \FOREIGN KEY (contract_metadata_id) REFERENCES contracts_metadata(id)\
    \FOREIGN KEY (type_id) REFERENCES xabi_types(id)\
  \);"
