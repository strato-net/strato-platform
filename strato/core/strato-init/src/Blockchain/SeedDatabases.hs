{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.SeedDatabases
  ( mkDatabases
  ) where

import BlockApps.Logging
import qualified Blockchain.Data.DataDefs as DataDefs
import qualified Blockchain.EthConf as UEC
import qualified Blockchain.EthConf.Model as EC
import Control.Monad
import Control.Monad.Composable.Kafka
import Control.Monad.Trans.Reader
import Data.String
import qualified Data.Text as T
import Database.Persist.Postgresql
import qualified Text.Colors as CL
import UnliftIO (MonadUnliftIO)
import UnliftIO.Exception (catch, SomeException)

-- | Create databases and Kafka topics.
-- Called by seed-genesis after docker containers are running.
mkDatabases :: (MonadLoggerIO m, MonadUnliftIO m, MonadFail m, HasKafka m) =>
               m ()
mkDatabases = do
  let ethconf = UEC.ethConf

  let pgconf = EC.sqlConfig ethconf
      rawConn = EC.postgreSQLConnectionString pgconf {EC.database = ""}
      localConn = EC.postgreSQLConnectionString pgconf
      db = EC.database pgconf
  $logInfoS "seed-genesis" . T.pack $ CL.yellow $ "Creating database: " ++ db
  $logInfoLS "seed-genesis" rawConn
  let query = T.pack $ "CREATE DATABASE " ++ show db ++ ";"

  catch
    (withPostgresqlConn rawConn (runReaderT (rawExecute query [])))
    (\(_ :: SomeException) -> $logInfoS "seed-genesis" "Database already exists, skipping")

  withPostgresqlConn localConn $
    runReaderT $ do
      $logInfoS "seed-genesis" . T.pack $ CL.yellow ">>>> Migrating eth"
      $logInfoLS "seed-genesis" localConn
      runMigration DataDefs.migrateAll
      $logInfoS "seed-genesis" . T.pack $ CL.yellow ">>>> Indexing eth"
      runMigration DataDefs.indexAll

  let topics :: [String] =
        [
        "statediff",
        "seq_vm_events",
        "seq_p2p_events",
        "unseqevents",
        "jsonrpcresponse",
        "indexevents",
        "vmevents",
        "solidvmevents"
        ]

  forM_ topics $ createTopic . fromString

  $logInfoS "seed-genesis" "Database and topic creation complete"
