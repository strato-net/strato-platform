{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}

module Blockchain.Slipstream.MessageConsumer
  ( getAndProcessMessages
  )
where

import BlockApps.Logging
import Blockchain.EthConf
import Blockchain.Slipstream.Data.Action (AggregateEvent)
import Blockchain.Slipstream.Metrics
import Blockchain.Slipstream.Processor
import Conduit
import Control.Monad
import Control.Monad.Composable.Kafka
import Control.Monad.Composable.SQL
import Data.String
import Blockchain.Slipstream.PostgresqlTypedShim
import Prelude hiding (lookup)

getAndProcessMessages ::
  ( MonadLogger m,
    HasKafka m,
    HasSQL m
  ) =>
  PGConnection ->
  m ()
getAndProcessMessages conn = do
  _ <- createTopic solidVmEventsTopicName

  consume "getAndProcessMessages'" "slipstream" "vmevents" $ \() messages -> do
    recordKafkaMessages messages
    emittedEvents <- runConduit $
      processTheMessages conn messages `fuseUpstream` sinkNull
    _ <- produceSolidVmEvents emittedEvents
    return ()

------ solidvmevents indexer code here ------
solidVmEventsTopicName :: TopicName
solidVmEventsTopicName = fromString "solidvmevents"

produceSolidVmEvents :: MonadIO m =>
                        [AggregateEvent] -> m [ProduceResponse]
produceSolidVmEvents = runKafkaMConfigured "slipstream" . produceItemsAsJSON solidVmEventsTopicName
