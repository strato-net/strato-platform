{-# LANGUAGE TemplateHaskell #-}
module Psql where

import           HFlags
import           Database.Persist.Sql
import           Database.Persist.Postgresql
import           BlockApps.Logging
import           Blockchain.EthConf
import qualified Blockchain.Data.Blockchain as DataBlock
import qualified Blockchain.Data.DataDefs as DataDefs
import qualified Blockchain.Strato.Discovery.Data.Peer as DataPeer

psql :: IO ()
psql = putStrLn $ "psql " ++ database (sqlConfig ethConf)

migrate :: String -> IO ()
migrate tables = do
  _ <- $initHFlags "migrate" -- I'm not sure that this makes sense to interleave with Ann, but we need minLogLevel
  runLoggingT
    . withPostgresqlConn connStr
    $ runSqlConn
    $ runMigration
    $ case tables of
          "all" -> DataDefs.migrateAll >> DataBlock.migrateAll >> DataPeer.migrateAll
          "data" -> DataDefs.migrateAll
          "global" -> DataBlock.migrateAll
          "peer" -> DataPeer.migrateAll
          _ -> error $ "unknown tables; must be one of (all|data|global|peer): " ++ tables
