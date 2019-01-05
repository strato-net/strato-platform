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
import Control.Monad.Logger
import Control.Monad.IO.Class
import Control.Monad.Trans.Reader
import Control.Monad.Trans.Resource
import qualified Data.ByteString.Char8 as BC
import Database.Persist.Postgresql
import Database.PostgreSQL.Typed
import Data.Time.Format
import HFlags
import Network.Kafka
import qualified Network.Kafka.Protocol as K hiding (Message)
import Network.Wai.Handler.Warp
import Network.Wai.Middleware.Prometheus
import System.Exit
import System.IO
import System.Log.Formatter
import System.Log.Handler hiding (handle, setLevel)
import System.Log.Handler.Simple
import System.Log.Logger
import Text.Printf

import Slipstream.MessageConsumer
import Slipstream.Globals
import Slipstream.GlobalsColdStorage
import Slipstream.Options
import Slipstream.OutputData

connStr :: ConnectionString
connStr = BC.pack $ printf "host=%s port=%d user=%s password=%s dbname=%s"
                           flags_pghost flags_pgport flags_pguser flags_password flags_database

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
  infoM "main" "Serving metrics on port 10777"

  conn <- liftIO $ pgConnect dbConnect
  msg <- runResourceT . runNoLoggingT . withPostgresqlConn connStr $ \simpleConn -> do
    (ourBloom, handle) <- runReaderT (initStorage flags_globalsStateCount) simpleConn
    unless ourBloom . liftIO . die $
      "storage has been previously initialized! This should not happen"
    let conCreate = "create table if not exists contract (id serial primary key, \"codeHash\" text, contract text, abi text);"
    dbInsert conn conCreate
    let conAlter =  "alter table contract add column if not exists \"chainId\" text;"
    dbInsert conn conAlter

    let offset = 0 :: K.Offset
        kafkaID = "slipstream" :: KafkaClientId
        state = mkConfiguredKafkaState kafkaID . fromIntegral $ flags_kafkaMaxBytes

    cachedContractsIORef <- newGlobals handle

    liftIO . runKafka state $ getAndProcessMessages conn cachedContractsIORef offset 0
  case msg of
    Left e -> die $ show e
    Right () -> infoM "main" "completing successfully"
