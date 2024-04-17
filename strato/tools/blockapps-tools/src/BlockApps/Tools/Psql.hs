{-# LANGUAGE TemplateHaskell #-}

module BlockApps.Tools.Psql where

import BlockApps.Logging
import qualified Blockchain.Data.DataDefs as DataDefs
import Blockchain.EthConf
import qualified Blockchain.Strato.Discovery.Data.Peer as DataPeer
import Database.Persist.Postgresql
import HFlags

migrate :: String -> IO ()
migrate tables = do
  _ <- $initHFlags "migrate" -- I'm not sure that this makes sense to interleave with Ann, but we need minLogLevel
  runLoggingT
    . withPostgresqlConn connStr
    $ runSqlConn $
      runMigration $
        case tables of
          "all" -> DataDefs.migrateAll >> DataPeer.migrateAll
          "data" -> DataDefs.migrateAll
          "peer" -> DataPeer.migrateAll
          _ -> error $ "unknown tables; must be one of (all|data|global|peer): " ++ tables
