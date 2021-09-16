{-# LANGUAGE
      OverloadedStrings
    , RecordWildCards
    , QuasiQuotes
    , ScopedTypeVariables
    , DataKinds
    , TemplateHaskell
    , FlexibleContexts
#-}

import Control.Concurrent
import Control.Monad
import Control.Monad.IO.Class
import Control.Monad.Trans.Class (lift)
import Control.Monad.Trans.Reader
import Control.Monad.Trans.Resource
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import Data.Cache
import Database.Persist.Postgresql
import Database.PostgreSQL.Typed
import HFlags
import Network.Kafka hiding (runKafka)
import Network.Wai.Handler.Warp
import Network.Wai.Middleware.Prometheus
import System.Clock
import System.Exit
import Text.Printf
import Text.RawString.QQ

import BlockApps.Bloc22.Monad (BlocEnv(..))
import BlockApps.Init
import BlockApps.Logging

import Control.Monad.Composable.BlocSQL

import Slipstream.MessageConsumer
import Slipstream.Globals
import Slipstream.GlobalsColdStorage
import Slipstream.Options
import Slipstream.OutputData


workerConnStr :: ConnectionString
workerConnStr = BC.pack $ printf "host=%s port=%d user=%s password=%s dbname=%s"
                        flags_pghost flags_pgport flags_pguser flags_password flags_database

createBlocEnv :: MonadIO m => m BlocEnv
createBlocEnv = liftIO $ do
  codePtrCache <- newCache . Just $ TimeSpec (fromIntegral flags_sourceCacheTimeout) 0
  return BlocEnv { stateFetchLimit = 0
                 , gasOn=error("gasOn shouldn't be needed in slipstream, it is undefined")
                 , evmCompatible=False
                 , globalNonceCounter=error("globalNonceCounter shouldn't be needed in slipstream, it is undefined")
                 , globalSourceCache=error("globalSourceCache shouldn't be needed in slipstream, it is undefined")
                 , globalCodePtrCache=codePtrCache
                 , txTBQueue=error("txTBQueue shouldn't be needed in slipstream, it is undefined")
    }
    

connectToCirrus :: MonadIO m => m PGConnection
connectToCirrus = liftIO $ pgConnect cirrusInfo

main :: IO ()
main = do
  _ <- $initHFlags "Setup Slipstream Variables"
  blockappsInit "slipstream_main"
  runLoggingT $ do
    $logInfoS "main" "Welcome to Slipstream!!!!"
    void . liftIO . forkIO . run 10777 $ metricsApp
    $logInfoS "main" "Serving metrics on port 10777"

    env <- createBlocEnv
    conn <- connectToCirrus
    let migrateCirrus :: B.ByteString -> LoggingT IO ()
        migrateCirrus = liftIO . void . pgQuery conn
    migrateCirrus  [r|create table if not exists
                      contract (id serial primary key, "codeHash" text, contract text, abi text)|]
    migrateCirrus [r|alter table contract add column if not exists "chainId" text|]

    -- There are three permanent connections/pools to postgres:
    -- 1. The `workerConn` is from persistent-postgresql for the storage worker in the background
    -- 2. `conn` connects slipstream to the cirrus database
    -- 3. The `pool` in the BlocEnv connects slipstream to the bloc22 database
    msg <- runResourceT . withPostgresqlConn workerConnStr $ \workerConn -> do
      (ourBloom, handle) <- runReaderT (initStorage flags_globalsStateCount) workerConn
      unless ourBloom . liftIO . die $
        "storage has been previously initialized! This should not happen"

      let state = mkConfiguredKafkaState ("slipstream" :: KafkaClientId) . fromIntegral $ flags_kafkaMaxBytes

      gref <- newGlobals handle
      sqlEnv <- createBlocSQLEnv flags_pghost (fromIntegral flags_pgport) flags_pguser flags_password
      
      lift . runKafka state $ getAndProcessMessages env sqlEnv conn gref
    case msg of
      Left e -> liftIO . die $ show e
      Right () -> $logInfoS "main" "completing successfully"
