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
import Blockchain.EthConf (cirrusConnStr, currentCellId, ethConf, runStreamMConfigured)
import qualified Blockchain.EthConf.Model as EC
import Blockchain.Slipstream.Data.CirrusTables
import Blockchain.Slipstream.MessageConsumer
import Blockchain.Slipstream.Options ()
import Blockchain.Slipstream.OutputData
import Blockchain.Slipstream.PostgresqlTypedShim
import Control.Concurrent
import Control.Monad
import Control.Monad.Composable.Streaming (createTopicAndWait)
import Control.Monad.Composable.Base (runEff, withResources)
import Control.Monad.Composable.SQL
import Control.Monad.IO.Class
import Data.String (fromString)
import Data.Text.Encoding (encodeUtf8)
import qualified Data.Text as T
import Database.Persist.Postgresql
import HFlags
import Instrumentation
import Network.Wai.Handler.Warp
import Network.Wai.Middleware.Prometheus

main :: IO ()
main = do
  _ <- $initHFlags "Setup Slipstream Variables"
  blockappsInit "slipstream_main"
  runInstrumentation "slipstream"
  cell <- T.pack <$> currentCellId

  runEff
    . runLogging
    . withResources
    . runStreamMConfigured "slipstream"
    $ do
      $logInfoS "main" "Welcome to Slipstream!!!!"
      let metricsHost = EC.apiListenAddress $ EC.apiConfig ethConf
      void . liftIO . forkIO . runSettings (setHost (fromString metricsHost) $ setPort 10777 defaultSettings) $ metricsApp
      $logInfoS "main" "Serving metrics on port 10777"

      createTopicAndWait "vmevents"

      let cirrusConf = EC.cirrusConfig ethConf
          cirrusDb = EC.database cirrusConf
      $logInfoS "main" $ T.pack $ "Using cirrus database: " ++ cirrusDb

      conn <- createPostgresqlPool cirrusConnStr 10
      liftIO $ runSqlPersistMPool (runMigration migrateAll) conn

      _ <- traverse (liftIO . pgQuery conn . encodeUtf8 . slipstreamQueryPostgres) initialSlipstreamQueries

      -- There are two permanent connections/pools to postgres:
      -- 1. `conn` connects slipstream to the cirrus database
      -- 2. The `pool` in the BlocEnv connects slipstream to the eth database

      $logInfoS "main" . T.pack $ "cell " ++ T.unpack cell ++ ": writing only while this cell holds the writer lease"
      runSQLM $
        getAndProcessMessages cell conn
