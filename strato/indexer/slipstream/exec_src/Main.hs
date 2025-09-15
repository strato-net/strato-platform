{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}

import BlockApps.Init
import BlockApps.Logging
import Blockchain.Slipstream.Globals
import Blockchain.Slipstream.GlobalsColdStorage
import Blockchain.Slipstream.MessageConsumer
import Blockchain.Slipstream.Options
import Blockchain.Slipstream.OutputData
import Control.Concurrent
import Control.Monad
import Control.Monad.Composable.Kafka
import Control.Monad.Composable.SQL
import Control.Monad.IO.Class
import Control.Monad.Trans.Reader
import Control.Monad.Trans.Resource
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import Data.Set as S (empty)
import Data.String
import Database.Persist.Postgresql
import Database.PostgreSQL.Typed
import HFlags
import Instrumentation
import Network.Wai.Handler.Warp
import Network.Wai.Middleware.Prometheus

import Text.Printf
import Text.RawString.QQ

workerConnStr :: ConnectionString
workerConnStr =
  BC.pack $
    printf
      "host=%s port=%d user=%s password=%s dbname=%s"
      flags_pghost
      flags_pgport
      flags_pguser
      flags_password
      flags_database

connectToCirrus :: MonadIO m => m PGConnection
connectToCirrus = liftIO $ pgConnect cirrusInfo

main :: IO ()
main = do
  _ <- $initHFlags "Setup Slipstream Variables"
  blockappsInit "slipstream_main"
  runInstrumentation "slipstream"

  runLoggingT
    . runResourceT
    . runKafkaM ("slipstream" :: KafkaClientId) (fromString flags_kafkahost, fromIntegral flags_kafkaport)
    . withPostgresqlConn workerConnStr
    $ \workerConn -> do
      $logInfoS "main" "Welcome to Slipstream!!!!"
      void . liftIO . forkIO . run 10777 $ metricsApp
      $logInfoS "main" "Serving metrics on port 10777"

      conn <- connectToCirrus
      let migrateCirrus :: MonadIO m => B.ByteString -> m ()
          migrateCirrus = liftIO . void . pgQuery conn
      migrateCirrus
        [r|CREATE TABLE IF NOT EXISTS contract (
                address text,
                block_hash text,
                block_timestamp text,
                block_number text,
                transaction_hash text NOT NULL,
                transaction_sender text,
                creator text,
                root text,
                application text,
                contract_name text,
                data jsonb,
                PRIMARY KEY (address)
            )|]
      migrateCirrus
        [r|CREATE TABLE IF NOT EXISTS record (
                address text,
                block_hash text,
                block_timestamp text,
                block_number text,
                transaction_hash text NOT NULL,
                transaction_sender text,
                key jsonb,
                value jsonb,
                CONSTRAINT contract_record FOREIGN KEY (address) REFERENCES contract (address)
            )|]
      migrateCirrus
        [r|CREATE TABLE IF NOT EXISTS event (
                address text,
                block_hash text,
                block_timestamp text,
                block_number text,
                transaction_hash text NOT NULL,
                transaction_sender text,
                event_index integer NOT NULL,
                creator text,
                application text,
                contract_name text,
                event_name text,
                attributes jsonb,
                PRIMARY KEY (transaction_hash, event_index),
                CONSTRAINT contract_event FOREIGN KEY (address) REFERENCES contract (address)
            )|]

      -- There are three permanent connections/pools to postgres:
      -- 1. The `workerConn` is from persistent-postgresql for the storage worker in the background
      -- 2. `conn` connects slipstream to the cirrus database
      -- 3. The `pool` in the BlocEnv connects slipstream to the bloc22 database

      handle <- runSqlConn initStorage workerConn
      gref <- newGlobals handle (CirrusHandle conn S.empty)

      flip runReaderT gref . runSQLM $
        getAndProcessMessages conn
