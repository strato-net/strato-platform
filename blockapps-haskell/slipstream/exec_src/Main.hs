{-# LANGUAGE
      OverloadedStrings
    , RecordWildCards
    , DeriveGeneric
    , QuasiQuotes
    , ScopedTypeVariables
    , DataKinds
    , TemplateHaskell
    , FlexibleContexts
#-}

import Control.Concurrent
import Control.Monad
import Control.Monad.Log (Severity(..))
import Control.Monad.Logger
import Control.Monad.IO.Class
import Control.Monad.Trans.Reader
import Control.Monad.Trans.Resource
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import Database.Persist.Postgresql
import Database.PostgreSQL.Simple
import Database.PostgreSQL.Typed
import Data.Pool
import Data.Time.Format
import HFlags
import Network.HTTP.Client
import Network.Kafka
import Network.Wai.Handler.Warp
import Network.Wai.Middleware.Prometheus
import Servant.Client (parseBaseUrl)
import System.Exit
import System.IO
import System.Log.Formatter
import System.Log.Handler hiding (handle, setLevel, close)
import System.Log.Handler.Simple
import System.Log.Logger
import Text.Printf
import Text.RawString.QQ

import BlockApps.Bloc22.Monad (BlocEnv(..), DeployMode(..))
import Blockapps.Crossmon
import Slipstream.MessageConsumer
import Slipstream.Globals
import Slipstream.GlobalsColdStorage
import Slipstream.Options
import Slipstream.OutputData

workerConnStr :: ConnectionString
workerConnStr = BC.pack $ printf "host=%s port=%d user=%s password=%s dbname=%s"
                        flags_pghost flags_pgport flags_pguser flags_password flags_database

createBlocEnv :: IO BlocEnv
createBlocEnv = do
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
                 , logLevel = Error
                 , deployMode = Public
                 , stateFetchLimit = 0
                 }

connectToCirrus :: IO PGConnection
connectToCirrus = pgConnect cirrusInfo

main::IO ()
main = do
  _ <- $initHFlags "Setup Slipstream Variables"
  let timeFormat = iso8601DateFormat (Just "%TZ")
  let formatter = tfLogFormatter timeFormat "[$utcTime $prio $loggername] $msg"
  let level = if flags_debug then DEBUG else INFO
  handler <- streamHandler stdout level
  updateGlobalLogger rootLoggerName $ setLevel level
                                    . setHandlers [setFormatter handler formatter]
  hSetBuffering stdout LineBuffering
  hSetBuffering stdin LineBuffering

  infoM "main" "Welcome to Slipstream!!!!"
  void . forkIO . run 10777 $ metricsApp
  initializeHealthChecks "slipstream_main"
  infoM "main" "Serving metrics on port 10777"

  env <- createBlocEnv
  conn <- connectToCirrus
  let migrateCirrus :: B.ByteString -> IO ()
      migrateCirrus = void . pgQuery conn
  migrateCirrus  [r|create table if not exists
                    contract (id serial primary key, "codeHash" text, contract text, abi text)|]
  migrateCirrus [r|alter table contract add column if not exists "chainId" text|]

  -- There are three permanent connections/pools to postgres:
  -- 1. The `workerConn` is from persistent-postgresql for the storage worker in the background
  -- 2. `conn` connects slipstream to the cirrus database
  -- 3. The `pool` in the BlocEnv connects slipstream to the bloc22 database
  msg <- runResourceT . runNoLoggingT . withPostgresqlConn workerConnStr $ \workerConn -> do
    (ourBloom, handle) <- runReaderT (initStorage flags_globalsStateCount) workerConn
    unless ourBloom . liftIO . die $
      "storage has been previously initialized! This should not happen"

    let state = mkConfiguredKafkaState ("slipstream" :: KafkaClientId) . fromIntegral $ flags_kafkaMaxBytes

    gref <- newGlobals handle

    liftIO . runKafka state $ getAndProcessMessages env conn gref 0 0
  case msg of
    Left e -> die $ show e
    Right () -> infoM "main" "completing successfully"
