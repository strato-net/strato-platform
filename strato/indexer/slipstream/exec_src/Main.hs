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
import Blockchain.EthConf (cirrusConnStr, ethConf, runKafkaMConfigured)
import qualified Blockchain.EthConf.Model as EC
import Blockchain.Slipstream.Data.CirrusTables
import Blockchain.Slipstream.MessageConsumer
import Blockchain.Slipstream.Options ()
import Blockchain.Slipstream.OutputData
import Blockchain.Slipstream.PostgresqlTypedShim
import Control.Concurrent
import Control.Monad
import Control.Monad.Composable.SQL
import Control.Monad.IO.Class
import Control.Monad.Trans.Reader (runReaderT)
import Control.Monad.Trans.Resource
import Data.Text.Encoding (encodeUtf8)
import qualified Data.Text as T
import Database.Persist.Postgresql
import HFlags
import Instrumentation
import Network.Wai.Handler.Warp
import Network.Wai.Middleware.Prometheus
import UnliftIO.Exception (catch, SomeException)

main :: IO ()
main = do
  _ <- $initHFlags "Setup Slipstream Variables"
  blockappsInit "slipstream_main"
  runInstrumentation "slipstream"

  runLoggingT
    . runResourceT
    . runKafkaMConfigured "slipstream"
    $ do
      $logInfoS "main" "Welcome to Slipstream!!!!"
      void . liftIO . forkIO . run 10777 $ metricsApp
      $logInfoS "main" "Serving metrics on port 10777"

      -- Create cirrus database if it doesn't exist
      let cirrusConf = EC.cirrusConfig ethConf
          rawConn = EC.postgreSQLConnectionString cirrusConf {EC.database = ""}
          cirrusDb = EC.database cirrusConf
          query = T.pack $ "CREATE DATABASE " ++ show cirrusDb ++ ";"
      $logInfoS "main" $ T.pack $ "Ensuring cirrus database exists: " ++ cirrusDb
      catch
        (withPostgresqlConn rawConn (runReaderT (rawExecute query [])))
        (\(_ :: SomeException) -> $logInfoS "main" "Database already exists, continuing")

      conn <- createPostgresqlPool cirrusConnStr 10
      liftIO $ runSqlPersistMPool (runMigration migrateAll) conn

      _ <- traverse (liftIO . pgQuery conn . encodeUtf8 . slipstreamQueryPostgres) initialSlipstreamQueries

      -- There are two permanent connections/pools to postgres:
      -- 1. `conn` connects slipstream to the cirrus database
      -- 2. The `pool` in the BlocEnv connects slipstream to the eth database

      runSQLM $
        getAndProcessMessages conn
