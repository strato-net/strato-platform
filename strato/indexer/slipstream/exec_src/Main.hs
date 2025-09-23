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
import Blockchain.Slipstream.MessageConsumer
import Blockchain.Slipstream.Options
import Blockchain.Slipstream.OutputData
import Control.Concurrent
import Control.Monad
import Control.Monad.Composable.Kafka
import Control.Monad.Composable.SQL
import Control.Monad.IO.Class
import Control.Monad.Trans.Resource
import qualified Data.ByteString as B
import Data.String
import Blockchain.Slipstream.PostgresqlTypedShim
import HFlags
import Instrumentation
import Network.Wai.Handler.Warp
import Network.Wai.Middleware.Prometheus

import Text.RawString.QQ

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
    $ do
      $logInfoS "main" "Welcome to Slipstream!!!!"
      void . liftIO . forkIO . run 10777 $ metricsApp
      $logInfoS "main" "Serving metrics on port 10777"

      conn <- connectToCirrus
      let migrateCirrus :: MonadIO m => B.ByteString -> m ()
          migrateCirrus = liftIO . void . pgQuery conn
      migrateCirrus
        [r|CREATE TABLE IF NOT EXISTS storage (
                address text,
                block_hash text,
                block_timestamp text,
                block_number text,
                transaction_hash text,
                transaction_sender text,
                creator text,
                root text,
                application text,
                contract_name text,
                data jsonb,
                PRIMARY KEY (address)
            )|]
      migrateCirrus
        [r|CREATE TABLE IF NOT EXISTS "history@storage" (
                address text,
                block_hash text,
                block_timestamp text,
                block_number text,
                transaction_hash text,
                transaction_sender text,
                creator text,
                root text,
                application text,
                contract_name text,
                data jsonb
            )|]
      migrateCirrus
        [r|CREATE TABLE IF NOT EXISTS contract (
                address text,
                creator text,
                application text,
                contract_name text,
                PRIMARY KEY (address, creator, application, contract_name),
                CONSTRAINT contract_storage FOREIGN KEY (address) REFERENCES storage (address)
            )|]
      migrateCirrus
        [r|CREATE TABLE IF NOT EXISTS mapping (
                address text,
                block_hash text,
                block_timestamp text,
                block_number text,
                transaction_hash text,
                transaction_sender text,
                root text,
                collection_name text,
                collection_type text,
                key jsonb,
                value jsonb,
                PRIMARY KEY (address, collection_name, key),
                CONSTRAINT contract_mapping FOREIGN KEY (address) REFERENCES storage (address)
            )|]
      migrateCirrus
        [r|CREATE TABLE IF NOT EXISTS event (
                id serial NOT NULL,
                address text,
                block_hash text,
                block_timestamp text,
                block_number text,
                transaction_hash text,
                transaction_sender text,
                event_index integer,
                creator text,
                application text,
                contract_name text,
                event_name text,
                attributes jsonb,
                PRIMARY KEY (transaction_hash, event_index),
                CONSTRAINT contract_event FOREIGN KEY (address) REFERENCES storage (address)
            )|]
      migrateCirrus
        [r|CREATE TABLE IF NOT EXISTS event_array (
                address text,
                block_hash text,
                block_timestamp text,
                block_number text,
                transaction_hash text,
                transaction_sender text,
                event_name text,
                event_index integer,
                collection_name text,
                collection_type text,
                key jsonb,
                value jsonb,
                PRIMARY KEY (address, transaction_hash, event_index, collection_name, key),
                CONSTRAINT event_array FOREIGN KEY (transaction_hash, event_index) REFERENCES event (transaction_hash, event_index)
            )|]

      -- There are two permanent connections/pools to postgres:
      -- 1. `conn` connects slipstream to the cirrus database
      -- 2. The `pool` in the BlocEnv connects slipstream to the eth database

      runSQLM $
        getAndProcessMessages conn
