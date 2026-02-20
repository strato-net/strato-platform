{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Slipstream.Options where

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
