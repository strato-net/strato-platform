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
import Database.Persist.Postgresql
import Database.PostgreSQL.Simple
import Database.PostgreSQL.Typed
import Data.Pool
import HFlags
import Network.HTTP.Client
import Network.Kafka hiding (runKafka)
import Network.Wai.Handler.Warp
import Network.Wai.Middleware.Prometheus
import Servant.Client (parseBaseUrl)
import System.Exit
import Text.Printf
import Text.RawString.QQ

import BlockApps.Bloc22.Monad (BlocEnv(..), DeployMode(..))
import BlockApps.Init
import BlockApps.Logging
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
  let dbConnectInfo = ConnectInfo
        { connectHost     = flags_pghost
        , connectPort     = fromIntegral flags_pgport
        , connectUser     = flags_pguser
        , connectPassword = flags_password
        , connectDatabase = "bloc22"
        }
  stratoUrl <- parseBaseUrl flags_stratourl
  vaultwrapperUrl <- parseBaseUrl flags_vaultwrapperurl
  mgr <- newManager defaultManagerSettings
  pool <- createPool (connect dbConnectInfo) close 5 3 5
  return BlocEnv { urlStrato = stratoUrl
                 , urlVaultWrapper = vaultwrapperUrl
                 , httpManager = mgr
                 , dbPool = pool
                 , deployMode = Public
                 , stateFetchLimit = 0
                 }

connectToCirrus :: MonadIO m => m PGConnection
connectToCirrus = liftIO $ pgConnect cirrusInfo

main::IO ()
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
    migrateCirrus [r|create table if not exists
                      events ("txHash" text, "name" text, "args" text)|]
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
      lift . runKafka state $ getAndProcessMessages env conn gref
    case msg of
      Left e -> liftIO . die $ show e
      Right () -> $logInfoS "main" "completing successfully"
