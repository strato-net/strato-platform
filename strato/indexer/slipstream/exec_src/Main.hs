{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}

import Bloc.Monad (BlocEnv (..))
import BlockApps.Init
import BlockApps.Logging
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
-- import Slipstream.Processor

import SelectAccessible ()
import Slipstream.Globals
import Slipstream.GlobalsColdStorage
import Slipstream.MessageConsumer
import Slipstream.Options
import Slipstream.OutputData
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

createBlocEnv :: MonadIO m => m BlocEnv
createBlocEnv = liftIO $ do
  return
    BlocEnv
      { stateFetchLimit = 0,
        txSizeLimit = 0,
        accountNonceLimit = 0,
        gasLimit = 0,
        globalNonceCounter = error ("globalNonceCounter shouldn't be needed in slipstream, it is undefined"),
        txTBQueue = error ("txTBQueue shouldn't be needed in slipstream, it is undefined"),
        userRegistryAddress = 0x0,
        userRegistryCodeHash = Nothing,
        useWalletsByDefault = error "useWalletsByDefault shouldn't be needed in slipstream"
      }

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

      env <- createBlocEnv
      conn <- connectToCirrus
      let migrateCirrus :: MonadIO m => B.ByteString -> m ()
          migrateCirrus = liftIO . void . pgQuery conn
      migrateCirrus
        [r|create table if not exists
                      contract (id serial primary key, "codeHash" text, contract text, abi text)|]
      migrateCirrus [r|alter table contract add column if not exists "chainId" text|]

      -- There are three permanent connections/pools to postgres:
      -- 1. The `workerConn` is from persistent-postgresql for the storage worker in the background
      -- 2. `conn` connects slipstream to the cirrus database
      -- 3. The `pool` in the BlocEnv connects slipstream to the bloc22 database

      handle <- runSqlConn initStorage workerConn
      gref <- newGlobals handle (CirrusHandle conn S.empty)

      flip runReaderT gref . runSQLM $
        getAndProcessMessages env conn
