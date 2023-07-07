{-# LANGUAGE
      OverloadedStrings
    , RecordWildCards
    , QuasiQuotes
    , ScopedTypeVariables
    , DataKinds
    , TemplateHaskell
    , FlexibleContexts
    , TupleSections
#-}

import Control.Concurrent
import Control.Monad
import Control.Monad.IO.Class
import Control.Monad.Trans.Resource
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import Data.String
import Data.Set as S (empty)
import Database.Persist.Postgresql
import Database.PostgreSQL.Typed
import HFlags
import Network.Kafka hiding (runKafka)
import Network.Wai.Handler.Warp
import Network.Wai.Middleware.Prometheus
import Text.Printf
import Text.RawString.QQ

import Bloc.Monad (BlocEnv(..))
import BlockApps.Init
import BlockApps.Logging

import Control.Monad.Composable.Kafka
import Control.Monad.Composable.SQL

import Slipstream.MessageConsumer
import Slipstream.Globals
import Slipstream.GlobalsColdStorage
import Slipstream.Options
import Slipstream.OutputData

import SelectAccessible ()

workerConnStr :: ConnectionString
workerConnStr = BC.pack $ printf "host=%s port=%d user=%s password=%s dbname=%s"
                        flags_pghost flags_pgport flags_pguser flags_password flags_database


createBlocEnv :: MonadIO m => m BlocEnv
createBlocEnv = liftIO $ do
  return BlocEnv { stateFetchLimit = 0
                 , gasOn=error("gasOn shouldn't be needed in slipstream, it is undefined")
                 , evmCompatible=False
                 , txSizeLimit=0
                 , accountNonceLimit=0
                 , gasLimit=0
                 , globalNonceCounter=error("globalNonceCounter shouldn't be needed in slipstream, it is undefined")
                 , txTBQueue=error("txTBQueue shouldn't be needed in slipstream, it is undefined")
    }


connectToCirrus :: MonadIO m => m PGConnection
connectToCirrus = liftIO $ pgConnect cirrusInfo

main :: IO ()
main = do
  _ <- $initHFlags "Setup Slipstream Variables"
  blockappsInit "slipstream_main"

  runLoggingT
    . runResourceT
    . runKafkaM ("slipstream" :: KafkaClientId) (fromString flags_kafkahost, fromIntegral flags_kafkaport)
    . runSQLM
    . withPostgresqlConn workerConnStr $ \workerConn -> do

    $logInfoS "main" "Welcome to Slipstream!!!!"
    void . liftIO . forkIO . run 10777 $ metricsApp
    $logInfoS "main" "Serving metrics on port 10777"

    env <- createBlocEnv
    conn <- connectToCirrus
    let migrateCirrus :: MonadIO m => B.ByteString -> m ()
        migrateCirrus = liftIO . void . pgQuery conn
    migrateCirrus  [r|create table if not exists
                      contract (id serial primary key, "codeHash" text, contract text, abi text)|]
    migrateCirrus [r|alter table contract add column if not exists "chainId" text|]

    -- There are three permanent connections/pools to postgres:
    -- 1. The `workerConn` is from persistent-postgresql for the storage worker in the background
    -- 2. `conn` connects slipstream to the cirrus database
    -- 3. The `pool` in the BlocEnv connects slipstream to the bloc22 database

    handle <- runSqlConn initStorage workerConn
    gref <- newGlobals handle (CirrusHandle conn S.empty)

    getAndProcessMessages env conn gref
