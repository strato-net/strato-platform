{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}

module Slipstream.MessageConsumer
  ( getAndProcessMessages,
  )
where

import Bloc.Monad (BlocEnv)
import BlockApps.Logging
import Blockchain.DB.CodeDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.ChainInfo
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.ExtendedWord
import Control.Monad
import Control.Monad.Change.Alter
import Control.Monad.Change.Modify
import Control.Monad.Composable.Kafka
import Control.Monad.Composable.SQL
import qualified Data.Aeson as JSON
import qualified Data.ByteString.Lazy as BL
import Data.IORef
import Data.String
import Database.PostgreSQL.Typed
import qualified Network.Kafka as K
import qualified Network.Kafka.Producer as KProd
import qualified Network.Kafka.Protocol as KPrtcl hiding (Message)
import Slipstream.Data.Action (AggregateEvent)
import Slipstream.Globals
import Slipstream.Metrics
import Slipstream.Processor
import SolidVM.Model.CodeCollection
import Prelude hiding (lookup)

getAndProcessMessages ::
  ( MonadLogger m,
    HasKafka m,
    HasSQL m,
    Accessible (IORef Globals) m,
    Selectable Account AddressState m,
    Selectable Account CodeCollection m,
    Selectable Account Contract m,
    Selectable Word256 ParentChainIds m,
    HasCodeDB m
  ) =>
  BlocEnv ->
  PGConnection ->
  m ()
getAndProcessMessages env conn = do
  _ <- execKafka assertTopicCreation

  consume "getAndProcessMessages'" "slipstream" "statediff" $ \messages -> do
    recordKafkaMessages messages
    cache <- access (Proxy @(IORef Globals))
    forceGlobalEval cache
    emittedEvents <- processTheMessages env conn messages
    _ <- execKafka $ produceSolidVmEvents emittedEvents
    return ()

------ solidvmevents indexer code here ------
solidVmEventsTopicName :: KPrtcl.TopicName
solidVmEventsTopicName = fromString "solidvmevents"

assertTopicCreation :: K.Kafka k => k ()
assertTopicCreation = K.updateMetadata solidVmEventsTopicName

produceSolidVmEvents :: K.Kafka k => [AggregateEvent] -> k [KPrtcl.ProduceResponse]
produceSolidVmEvents es =
  KProd.produceMessagesAsSingletonSets $
    K.TopicAndMessage solidVmEventsTopicName . KProd.makeMessage . BL.toStrict . JSON.encode <$> es
