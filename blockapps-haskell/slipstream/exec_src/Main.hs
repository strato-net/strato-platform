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

main::IO ()
main = do
  _ <- $initHFlags "Setup Slipstream Variables"

  let conCreate = "BEGIN; create table if not exists contract (id serial primary key, \"codeHash\" text, contract text, abi text); alter table contract add column \"chainId\" text; COMMIT;"
  dbInsert conCreate

  let offset = 0 :: K.Offset
  let kafkaID = "queryStrato" :: KafkaClientId
  let state = mkConfiguredKafkaState kafkaID

  msg <- runKafka state $ (getAndProcessMessages offset)

  messages <- case msg of
        Left e -> error $ show e
        Right y -> return y
  print messages
  return ()
