{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE NumericUnderscores #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.SeedDatabases
  ( mkDatabases
  ) where

import BlockApps.Logging
import Blockchain.BlockDB
import qualified Blockchain.Data.DataDefs as DataDefs
import Blockchain.DB.CodeDB
import Blockchain.DB.SQLDB
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader
import Blockchain.Data.BlockDB
import Blockchain.Data.Extra
import Blockchain.Data.GenesisBlock
import qualified Blockchain.Data.GenesisInfo as GI
import qualified Blockchain.Data.TXOrigin as Origin
import Blockchain.Init.Monad (runSetupDBM)
import qualified Blockchain.EthConf as UEC
import qualified Blockchain.EthConf.Model as EC
import Blockchain.Model.WrappedBlock (OutputBlock(..))
import Blockchain.Model.SyncState
import Blockchain.Sequencer.Bootstrap (bootstrapSequencer)
import qualified Blockchain.Strato.Indexer.ApiIndexer as ApiIndexer
import qualified Blockchain.Strato.Indexer.Kafka as IdxKafka
import qualified Blockchain.Strato.Indexer.Model as IdxModel
import Blockchain.Strato.Model.Class
import Blockchain.SyncDB
import Conduit
import Control.Monad
import Control.Monad.Composable.Kafka
import Control.Monad.Composable.Redis
import Control.Monad.Composable.SQL
import Control.Monad.Trans.Reader
import Data.String
import qualified Data.Text as T
import Database.Persist.Postgresql
import Text.Format
import qualified Text.Colors as CL
import UnliftIO.Exception (catch, SomeException)

-- | Seed databases (Redis, Kafka, PostgreSQL) with genesis block data.
-- Called by seed-genesis after docker containers are running.
-- Reads genesis.json which must already exist (created by strato-setup).
mkDatabases :: (MonadLoggerIO m, MonadUnliftIO m, MonadFail m, HasKafka m) =>
               m ()
mkDatabases = do
  -- Read ethconf from file (created by strato-setup)
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

  runResourceT . runSetupDBM . runRedisM UEC.lookupRedisBlockDBConfig . runSQLM $ do
    $logInfoS "seed-genesis" "Seeding databases from genesis.json"
    seedDatabases
    $logInfoS "seed-genesis" "Database seeding complete"

-- | Seed databases (Redis, Kafka, PostgreSQL) with genesis block data.
-- This is called by seed-genesis (after docker containers are running).
-- Reads genesis.json which must already exist with correct stateRoot and validators.
seedDatabases ::
  ( HasCodeDB m,
    HasRedis m,
    HasSQLDB m,
    MonadLogger m
  ) =>
  m ()
seedDatabases = do
  $logInfoS "seed-genesis" "Reading genesis.json"
  genesisInfo <- liftIO GI.getGenesisInfo
  let genesisBlock = genesisInfoToBlock genesisInfo
      validators' = GI.validators genesisInfo
  $logInfoS "seed-genesis" $ T.pack $ "Genesis hash: " ++ format (blockHash genesisBlock)
  $logInfoS "seed-genesis" $ T.pack $ "Validators: " ++ show (length validators')

  obGB <- liftIO $ bootstrapSequencer genesisBlock
  putGenesisHash $ blockHash genesisBlock
  void $ putBlocks [genesisBlock] False

  _ <- execRedis $ putBestSequencedBlockInfo $ BestSequencedBlock (blockHash genesisBlock) 0 validators'

  void . execRedis $ do
    forceBestBlockInfo
      (blockHash genesisBlock)
      (number . blockBlockData $ genesisBlock)

  void . execRedis $
    putBlock OutputBlock
    { obOrigin = Origin.Direct,
      obBlockData = blockBlockData genesisBlock,
      obReceiptTransactions = [],
      obBlockUncles = []
    }

  liftIO $ bootstrapIndexer obGB
  $logInfoS "seed-genesis" "Database seeding complete"


bootstrapIndexer :: OutputBlock -> IO ()
bootstrapIndexer obGB = do
  let clientId = fst ApiIndexer.kafkaClientIds
  putStrLn "About to bootstrap index events"
  res <-
    UEC.runKafkaMConfigured clientId $
    IdxKafka.produceIndexEvents [IdxModel.RanBlock obGB]

  print res
  putStrLn "bootstrapIndex genesis seed successful!"
