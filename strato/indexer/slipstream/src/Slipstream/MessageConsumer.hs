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
import Blockchain.EthConf
import Control.Monad
import Control.Monad.Change.Alter
import Control.Monad.Change.Modify
import Control.Monad.IO.Class
import Control.Monad.Composable.Kafka
import Control.Monad.Composable.SQL
import Data.IORef
import Data.String
import Database.PostgreSQL.Typed
import Slipstream.Data.Action (AggregateEvent)
import Slipstream.Globals
import Slipstream.Metrics
import Slipstream.Processor
import Prelude hiding (lookup)

getAndProcessMessages ::
  ( MonadLogger m,
    HasKafka m,
    HasSQL m,
    Accessible (IORef Globals) m
  ) =>
  BlocEnv ->
  PGConnection ->
  m ()
getAndProcessMessages env conn = do
  _ <- createTopic solidVmEventsTopicName

  consume "getAndProcessMessages'" "slipstream" "vmevents" $ \() messages -> do
    recordKafkaMessages messages
    cache <- access (Proxy @(IORef Globals))
    forceGlobalEval cache
    emittedEvents <- processTheMessages env conn messages
    _ <- produceSolidVmEvents emittedEvents
    return ()

------ solidvmevents indexer code here ------
solidVmEventsTopicName :: TopicName
solidVmEventsTopicName = fromString "solidvmevents"

produceSolidVmEvents :: MonadIO m =>
                        [AggregateEvent] -> m [ProduceResponse]
produceSolidVmEvents = runKafkaMConfigured "slipstream" . produceItemsAsJSON solidVmEventsTopicName
