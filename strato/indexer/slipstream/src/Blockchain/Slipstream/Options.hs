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
