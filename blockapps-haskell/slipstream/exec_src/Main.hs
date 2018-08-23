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

import Network.Kafka
import qualified Network.Kafka.Protocol as K hiding (Message)
import HFlags
import Slipstream.MessageConsumer
import Slipstream.OutputData
import Slipstream.Options ()
import Database.PostgreSQL.Typed
import qualified Data.Map as Map
import Data.IORef

main::IO ()
main = do
  _ <- $initHFlags "Setup Slipstream Variables"

  conn <- pgConnect dbConnect

  let conCreate = "create table if not exists contract (id serial primary key, \"codeHash\" text, contract text, abi text);"
  dbInsert conCreate conn
  let conAlter =  "alter table contract add column if not exists \"chainId\" text;"
  dbInsert conAlter conn

  let offset = 0 :: K.Offset
  let kafkaID = "queryStrato" :: KafkaClientId
  let state = mkConfiguredKafkaState kafkaID

  cachedContractsIORef <- newIORef Map.empty

  msg <- runKafka state $ (getAndProcessMessages conn cachedContractsIORef offset)

  messages <- case msg of
        Left e -> error $ show e
        Right y -> return y
  print messages
  return ()
