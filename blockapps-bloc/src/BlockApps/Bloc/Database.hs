{-# LANGUAGE
    OverloadedStrings
#-}

module BlockApps.Bloc.Database where

import qualified Hasql.Decoders as Decoders
import qualified Hasql.Encoders as Encoders
import Hasql.Query

usersTable :: Query () ()
usersTable = statement
  "CREATE TABLE users(\
    \id serial PRIMARY KEY,\
    \name varchar (512) NOT NULL UNIQUE,\
    \key_hash bytea NOT NULL,\
    \salt bytea NOT NULL,\
    \sig_bytes integer NOT NULL\
  \);"
  Encoders.unit
  Decoders.unit
  False

addressesTable :: Query () ()
addressesTable = statement
  "CREATE TABLE addresses(\
    \id serial PRIMARY KEY,\
    \address bytea NOT NULL UNIQUE,\
    \user_id NOT NULL REFERENCES users(id),\
    \seed_encryption_string bytea NOT NULL,\
    \seed_encryption_iv bytea NOT NULL,\
    \seed_encryption_salt bytea NOT NULL,\
    \hd_root_string bytea NOT NULL,\
    \hd_root_iv bytea NOT NULL,\
    \hd_root_salt bytea NOT NULL,\
    \encryption_key bytea NOT NULL,\
    \encryption_iv bytea NOT NULL,\
    \encryption_salt bytea NOT NULL,\
    \hd_index integer NOT NULL,\
    \FOREIGN KEY (user_id) REFERENCES users(id)\
  \);"
  Encoders.unit
  Decoders.unit
  False

contractsTable :: Query () ()
contractsTable = statement
  "CREATE TABLE contracts(\
    \id serial PRIMARY KEY,\
    \name varchar (512) NOT NULL UNIQUE\
  \);"
  Encoders.unit
  Decoders.unit
  False

contractsMetaDataTable :: Query () ()
contractsMetaDataTable = statement
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
  Encoders.unit
  Decoders.unit
  False

xabiFunctionsTable :: Query () ()
xabiFunctionsTable = statement
  "CREATE TABLE xabi_functions(\
    \id serial PRIMARY KEY,\
    \contract_metadata_id NOT NULL REFERENCES contracts_metadata(id),\
    \is_constructor boolean NOT NULL,\
    \name varchar(512) NOT NULL,\
    \selector bytea NOT NULL,\
    \FOREIGN KEY (contract_metadata_id) REFERENCES contracts_metatdata(id)\
  \);"
  Encoders.unit
  Decoders.unit
  False

xabiFunctionParametersTable :: Query () ()
xabiFunctionParametersTable = statement
  "CREATE TABLE xabi_function_parameters(\
    \id serial PRIMARY KEY,\
    \xabi_function_id NOT NULL REFERENCES xabi_functions(id),\
    \entry_id REFERENCES xabi_complex_entries(id),\
    \name varchar(512) NOT NULL,\
    \type varchar(512) NOT NULL,\
    \index integer NOT NULL,\
    \bytes integer NOT NULL,\
    \is_dynamic boolean NOT NULL,\
    \is_return_type boolean NOT NULL,\
    \FOREIGN KEY (xabi_function_id) REFERENCES xabi_functions(id),\
    \FOREIGN KEY (entry_id) REFERENCES xabi_complex_entries(id)\
  \);"
  Encoders.unit
  Decoders.unit
  False

xabiVariablesTable :: Query () ()
xabiVariablesTable = statement
  "CREATE TABLE xabi_variables(\
    \id serial PRIMARY KEY,\
    \contract_metadata_id NOT NULL REFERENCES contracts_metadata(id),\
    \entry_id REFERENCES xabi_complex_entries(id),\
    \name varchar(512) NOT NULL,\
    \type varchar(512) NOT NULL,\
    \at_bytes integer NOT NULL,\
    \bytes integer NOT NULL,\
    \is_dynamic boolean NOT NULL,\
    \FOREIGN KEY (contract_metadata_id) REFERENCES contracts_metadata(id),\
    \FOREIGN KEY (entry_id) REFERENCES xabi_complex_entries(id)\
  \);"
  Encoders.unit
  Decoders.unit
  False

xabiComplexEntriesTable :: Query () ()
xabiComplexEntriesTable = statement
  "CREATE TABLE xabi_complex_entries(\
    \id serial PRIMARY KEY,\
    \typedef varchar(512) NOT NULL,\
    \type varchar(512) NOT NULL,\
    \bytes integer NOT NULL,\
  \);"
  Encoders.unit
  Decoders.unit
  False

contractsInstanceTable :: Query () ()
contractsInstanceTable = statement
  "CREATE TABLE contracts_instance(\
    \id serial PRIMARY KEY,\
    \contract_metadata_id NOT NULL REFERENCES contracts_metadata(id),\
    \address bytea NOT NULL UNIQUE,\
    \timestamp timestamp NOT NULL,\
    \FOREIGN KEY (contract_metadata_id) REFERENCES contracts_metadata(id)\
  \);"
  Encoders.unit
  Decoders.unit
  False

contractsLookupTable :: Query () ()
contractsLookupTable = statement
  "CREATE TABLE contracts_lookup(\
    \contract_metadata_id NOT NULL REFERENCES contracts_metadata(id),\
    \linked_metadata_id NOT NULL REFERENCES contracts_metadata(id),\
    \PRIMARY KEY (contract_metadata_id, linked_metadata_id),\
    \FOREIGN KEY (contract_metadata_id) REFERENCES contracts_metadata(id),\
    \FOREIGN KEY (linked_metadata_id) REFERENCES contracts_metadata(id)\
  \);"
  Encoders.unit
  Decoders.unit
  False
