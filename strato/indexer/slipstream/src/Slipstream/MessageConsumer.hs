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
import Blockchain.MilenaTools
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Stream.VMEvent
import Control.Monad.Change.Alter
import Control.Monad.Change.Modify
import Control.Monad.Composable.Kafka
import Control.Monad.Composable.SQL
import qualified Data.Aeson as JSON
import qualified Data.ByteString.Lazy as BL
import Data.IORef
import Data.String
import qualified Data.Text as T
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

lookupTopic :: KPrtcl.TopicName
lookupTopic = fromString "statediff"

lookupPartition :: KPrtcl.Partition
lookupPartition = KPrtcl.Partition 0

lookupGroup :: KPrtcl.ConsumerGroup
lookupGroup = "slipstream"

getStatediffOffset ::
  (MonadLogger m, HasKafka m) =>
  m KPrtcl.Offset
getStatediffOffset = do
  resp <- execKafka $ fetchSingleOffset lookupGroup lookupTopic lookupPartition
  $logDebugLS "getStateDiffOffset/resp" resp
  case resp of
    Left KPrtcl.UnknownTopicOrPartition -> do
      $logInfoS "getStatediffOffset" "No offset found, creating one from 0"
      putStatediffOffset 0 >> getStatediffOffset
    Left err -> do
      $logErrorLS "getStatediffOffset" err
      error $ show err
    Right (off, _) -> return off

putStatediffOffset ::
  (MonadLogger m, HasKafka m) =>
  KPrtcl.Offset ->
  m ()
putStatediffOffset off = do
  $logInfoLS "putStateDiffOffset/req" off
  resp <- execKafka $ commitSingleOffset lookupGroup lookupTopic lookupPartition off ""
  $logDebugLS "putStateDiffOffset/resp" resp
  case resp of
    Left err -> do
      $logErrorLS "putStatediffOffset" err
      error $ show err
    Right () -> return ()

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
  let errorCount = 0
  _ <- execKafka assertTopicCreation
  offset <- getStatediffOffset
  getAndProcessMessages' env conn offset errorCount

getAndProcessMessages' ::
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
  KPrtcl.Offset ->
  Int ->
  m ()
getAndProcessMessages' env conn offset errorCounter = do
  $logInfoS "getAndProcessMessages'" $ T.pack $ "#### fetching VMEvents: Offset=" ++ show offset
  recordOffset offset
  messages <- execKafka $ fetchVMEvents offset
  recordKafkaMessages messages
  cache <- access (Proxy @(IORef Globals))
  forceGlobalEval cache
  emittedEvents <- processTheMessages env conn messages
  _ <- execKafka $ produceSolidVmEvents emittedEvents
  let newOffset = offset + fromIntegral (length messages)
  currentOffset <- getStatediffOffset
  offset' <-
    if currentOffset /= offset
      then do
        $logInfoLS "getAndProcessMessages'/manual_offset" currentOffset
        recordOffsetOverride
        return currentOffset
      else do
        putStatediffOffset newOffset
        return newOffset

  getAndProcessMessages' env conn offset' errorCounter

------ solidvmevents indexer code here ------
solidVmEventsTopicName :: KPrtcl.TopicName
solidVmEventsTopicName = fromString "solidvmevents"

assertTopicCreation :: K.Kafka k => k ()
assertTopicCreation = K.updateMetadata solidVmEventsTopicName

produceSolidVmEvents :: K.Kafka k => [AggregateEvent] -> k [KPrtcl.ProduceResponse]
produceSolidVmEvents es =
  KProd.produceMessagesAsSingletonSets $
    K.TopicAndMessage solidVmEventsTopicName . KProd.makeMessage . BL.toStrict . JSON.encode <$> es
