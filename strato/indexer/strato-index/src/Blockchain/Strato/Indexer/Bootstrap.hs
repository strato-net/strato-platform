{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Strato.Indexer.Bootstrap
  ( bootstrapIndexer,
  )
where

import BlockApps.Logging
import qualified Blockchain.Data.DataDefs as DataDefs
import Blockchain.Strato.Indexer.Kafka (indexEventsTopicName)
import Control.Monad.Composable.Kafka (createTopic)
import Control.Monad.Trans.Reader (runReaderT)
import qualified Data.Text as T
import Database.Persist.Postgresql (withPostgresqlConn, rawExecute, runMigration)
import qualified Blockchain.EthConf as UEC
import qualified Blockchain.EthConf.Model as EC
import qualified Text.Colors as CL
import UnliftIO (MonadUnliftIO)
import UnliftIO.Exception (catch, SomeException)

bootstrapIndexer :: (MonadLoggerIO m, MonadUnliftIO m) => m ()
bootstrapIndexer = do
  UEC.runKafkaMConfigured "strato-api-indexer" $ createTopic indexEventsTopicName
  let ethconf = UEC.ethConf
      pgconf = EC.sqlConfig ethconf
      rawConn = EC.postgreSQLConnectionString pgconf {EC.database = ""}
      localConn = EC.postgreSQLConnectionString pgconf
      db = EC.database pgconf

  $logInfoS "strato-index" . T.pack $ CL.yellow $ "Creating database: " ++ db
  let query = T.pack $ "CREATE DATABASE " ++ show db ++ ";"

  catch
    (withPostgresqlConn rawConn (runReaderT (rawExecute query [])))
    (\(_ :: SomeException) -> $logInfoS "strato-index" "Database already exists, skipping")

  withPostgresqlConn localConn $
    runReaderT $ do
      $logInfoS "strato-index" . T.pack $ CL.yellow ">>>> Migrating eth tables"
      runMigration DataDefs.migrateAll
      $logInfoS "strato-index" . T.pack $ CL.yellow ">>>> Indexing eth tables"
      runMigration DataDefs.indexAll

  $logInfoS "strato-index" "Database initialization complete"
