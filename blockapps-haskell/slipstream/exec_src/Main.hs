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

import Data.Default
import Data.IORef
import Database.PostgreSQL.Typed
import HFlags
import Network.Kafka
import qualified Network.Kafka.Protocol as K hiding (Message)
import System.IO
import System.Log.Logger

import Slipstream.MessageConsumer
import Slipstream.Options ()
import Slipstream.OutputData


main::IO ()
main = do
  _ <- $initHFlags "Setup Slipstream Variables"
  updateGlobalLogger rootLoggerName (setLevel INFO)
  hSetBuffering stdout LineBuffering
  hSetBuffering stdin LineBuffering

  putStrLn "Welcome to Slipstream!!!!"

  conn <- pgConnect dbConnect

  let conCreate = "create table if not exists contract (id serial primary key, \"codeHash\" text, contract text, abi text);"
  dbInsert conn conCreate
  let conAlter =  "alter table contract add column if not exists \"chainId\" text;"
  dbInsert conn conAlter

  let offset = 0 :: K.Offset
  let kafkaID = "slipstream" :: KafkaClientId
  let state = mkConfiguredKafkaState kafkaID

  cachedContractsIORef <- newIORef def

  msg <- runKafka state $ (getAndProcessMessages conn cachedContractsIORef offset)

  messages <- case msg of
        Left e -> error $ show e
        Right y -> return y
  print messages
  return ()
