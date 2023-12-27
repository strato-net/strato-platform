{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}

module Slipstream.Options where

import BlockApps.Logging ()
import HFlags

-- For --minLogLevel

defineFlag "pguser" ("postgres" :: String) "Postgres user"
defineFlag "pghost" ("postgres" :: String) "Postgres hostname"
defineFlag "pgport" (5432 :: Int) "Postgres port"
defineFlag "password" ("api" :: String) "Postgres password"
defineFlag "database" ("cirrus" :: String) "Postgres database"
defineFlag
  "stratourl"
  ("http://localhost:3000/eth/v1.2" :: String)
  "URL of the Strato server Bloc will connect to"
defineFlag
  "vaultwrapperurl"
  ("http://localhost:8013/strato/v2.3" :: String)
  "URL of the Vault Wrapper server Bloc will connect to"
defineFlag "kafkahost" ("kafka" :: String) "Kafka host"
defineFlag "kafkaport" (9092 :: Int) "Kafka port"

-- defineFlag "cirrusurl" ("http://postgrest:3001"::String) "URL of the Cirrus server Bloc will connect to"
defineFlag
  "globalsStateCount"
  (1024 :: Int)
  "The maximum number of states to keep in memory at once.\
  \ overflow is stored in postgres."

defineFlag "kafkaMaxBytes" (1024 * 1024 * 32 :: Int) "Number of bytes to read in each batch from kafka"
defineFlag "sourceCacheTimeout" (60 :: Integer) "The number of seconds nonces are held in the global source code cache"
