{-# LANGUAGE
    OverloadedStrings
#-}

module BlockApps.Bloc.Database where

import Data.ByteString (ByteString)

usersTable :: ByteString
usersTable =
  "CREATE TABLE users(\
    \name VARCHAR (255) PRIMARY KEY,\
    \seed_encryption_string bytea NOT NULL,\
    \seed_encryption_iv bytea NOT NULL,\
    \seed_encryption_salt bytea NOT NULL,\
    \hd_root_string bytea NOT NULL,\
    \hd_root_iv bytea NOT NULL,\
    \hd_root_salt bytea NOT NULL,\
    \key_hash bytea NOT NULL,\
    \salt bytea NOT NULL,\
    \sig_bytes integer NOT NULL\
  \);"

addressesTable :: ByteString
addressesTable =
  "CREATE TABLE addresses(\
    \address bytea PRIMARY KEY,\
    \user_name REFERENCES users(name),\
    \encryption_key bytea NOT NULL,\
    \encryption_iv bytea NOT NULL,\
    \encryption_salt bytea NOT NULL,\
    \hd_index integer NOT NULL\
  \);"

contractsTable :: ByteString
contractsTable = "CREATE TABLE contracts();"
