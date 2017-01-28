{-# LANGUAGE
    OverloadedStrings
#-}

module BlockApps.Bloc.Database where

import Data.ByteString (ByteString)

usersTable :: ByteString
usersTable =
  "CREATE TABLE users(\
    \id serial PRIMARY KEY,\
    \name varchar (255) NOT NULL UNIQUE,\
    \key_hash bytea NOT NULL,\
    \salt bytea NOT NULL,\
    \sig_bytes integer NOT NULL\
  \);"

addressesTable :: ByteString
addressesTable =
  "CREATE TABLE addresses(\
    \id serial PRIMARY KEY,\
    \address bytea NOT NULL UNIQUE,\
    \user_id REFERENCES users(id),\
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

contractsTable :: ByteString
contractsTable =
  "CREATE TABLE contracts(\
    \id serial PRIMARY KEY,\
    \name varchar (255) NOT NULL UNIQUE\
  \);"

contractsMetaDataTable :: ByteString
contractsMetaDataTable =
  "CREATE TABLE contracts_metadata(\
    \id serial PRIMARY KEY,\
    \contract_id REFERENCES contracts(id),\
    \bin bytea NOT NULL,\
    \bin_runtime bytea NOT NULL,\
    \bin_runtime_hash NOT NULL,\
    \code_hash bytea NOT NULL,\
    \xabi json NOT NULL,\
    \UNIQUE (bin_runtime_hash, code_hash),\
    \FOREIGN KEY (contract_id) REFERENCES contracts(id)\
  \);"

contractsInstanceTable :: ByteString
contractsInstanceTable =
  "CREATE TABLE contracts_instance(\
    \id serial PRIMARY KEY,\
    \contract_metadata_id REFERENCES contracts_metadata(id),\
    \address bytea NOT NULL UNIQUE,\
    \FOREIGN KEY (contract_metadata_id) REFERENCES contracts_metadata(id)\
  \);"

contractsLookupTable :: ByteString
contractsLookupTable =
  "CREATE TABLE contracts_lookup(\
    \contract_metadata_id REFERENCES contracts_metadata(id),\
    \linked_metadata_id REFERENCES contracts_metadata(id),\
    \PRIMARY KEY (contract_metadata_id, linked_metadata_id),\
    \FOREIGN KEY (contract_metadata_id) REFERENCES contracts_metadata(id),\
    \FOREIGN KEY (linked_metadata_id) REFERENCES contracts_metadata(id)\
  \);"
