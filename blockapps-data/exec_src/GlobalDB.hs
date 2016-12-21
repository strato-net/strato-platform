{-# LANGUAGE TemplateHaskell #-}
module Main where

import Blockchain.Data.Blockchain
import Blockchain.EthConf
import HFlags 

defineFlag "u:pguser" ("postgres" :: String) "Postgres user"
defineFlag "P:pghost" ("localhost" :: String) "Postgres hostname"
defineFlag "p:password" ("api" :: String) "Postgres password"
$(return [])

main :: IO ()
main = do
    _ <- $initHFlags "Migrate global blockchain database"

    let cfg = SqlConf {
      user = flags_pguser,
      password = flags_password,
      host = flags_pghost,
      port = 5432,
      database = "blockchain",
      poolsize = 1
    }

    createDB $ postgreSQLConnectionString cfg{database = "postgres"}
    migrateDB $ postgreSQLConnectionString cfg
