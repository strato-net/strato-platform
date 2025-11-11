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
import Blockchain.Slipstream.Data.CirrusTables
import Blockchain.Slipstream.MessageConsumer
import Blockchain.Slipstream.Options
import Blockchain.Slipstream.OutputData
import Control.Concurrent
import Control.Monad
import Control.Monad.Composable.Kafka
import Control.Monad.Composable.SQL
import Control.Monad.IO.Class
import Control.Monad.Trans.Resource
import Data.String
import Data.Text.Encoding (encodeUtf8)
import Database.Persist.Postgresql
import Blockchain.Slipstream.PostgresqlTypedShim
import HFlags
import Instrumentation
import Network.Wai.Handler.Warp
import Network.Wai.Middleware.Prometheus

main :: IO ()
main = do
  _ <- $initHFlags "Setup Slipstream Variables"
  blockappsInit "slipstream_main"
  runInstrumentation "slipstream"

  let connStr = "host=localhost dbname=cirrus user=postgres password=api port=5432"

  runNoLoggingT $ do
    pool <- createPostgresqlPool connStr 1
    liftIO $ runSqlPersistMPool (runMigration migrateAll) pool

  runLoggingT
    . runResourceT
    . runKafkaM ("slipstream" :: KafkaClientId) (fromString flags_kafkahost, fromIntegral flags_kafkaport)
    $ do
      $logInfoS "main" "Welcome to Slipstream!!!!"
      void . liftIO . forkIO . run 10777 $ metricsApp
      $logInfoS "main" "Serving metrics on port 10777"

      conn <- createPostgresqlPool connStr 10

      _ <- traverse (liftIO . pgQuery conn . encodeUtf8 . slipstreamQueryPostgres) initialSlipstreamQueries

      -- There are two permanent connections/pools to postgres:
      -- 1. `conn` connects slipstream to the cirrus database
      -- 2. The `pool` in the BlocEnv connects slipstream to the eth database

      runSQLM $
        getAndProcessMessages conn
