
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE QuasiQuotes #-}

module Slipstream.Options where

import HFlags

defineFlag "pguser" ("postgres" :: String) "Postgres user"
defineFlag "pghost" ("localhost" :: String) "Postgres hostname"
defineFlag "pgport" ("5432" :: String) "Postgres port"
defineFlag "password" ("api" :: String) "Postgres password"
defineFlag "database" ("postgres" :: String) "Postgres database"
defineFlag "stratourl" ("http://strato-int.centralus.cloudapp.azure.com/strato-api/eth/v1.2"::String) "URL of the Strato server Bloc will connect to"
defineFlag "vaultwrapperurl" ("http://strato-int.centralus.cloudapp.azure.com/strato/v2.3"::String) "URL of the Vault Wrapper server Bloc will connect to"
defineFlag "kafkahost" ("kafka" :: String) "Kafka host"
defineFlag "kafkaport" (9092 :: Int) "Kafka port"
defineFlag "historyList" ("" :: String) "List of contract with enabled history"
-- defineFlag "cirrusurl" ("http://postgrest:3001"::String) "URL of the Cirrus server Bloc will connect to"
