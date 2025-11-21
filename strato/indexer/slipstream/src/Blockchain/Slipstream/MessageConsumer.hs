{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}

{-# OPTIONS -fno-warn-deprecations #-}

module Blockchain.Slipstream.MessageConsumer
  ( getAndProcessMessages
  )
where

import BlockApps.Logging
import Blockchain.Data.TransactionResult
import Blockchain.EthConf
import Blockchain.Slipstream.Data.Action (AggregateEvent)
import Blockchain.Slipstream.Metrics
import Blockchain.Slipstream.Processor
import Blockchain.Slipstream.OutputData
import Blockchain.Slipstream.SQL
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
      processTheMessages messages `fuseUpstream`
        dedupC `fuseUpstream`
        awaitForever (\case
          Left txr -> void . lift $ putTransactionResult txr
          Right cmd -> lift $ case cmd of
            InsertDelegatecall dc -> insertDelegatecallPostgres conn dc
            _ -> dbQueryCatchError conn $ slipstreamQueryPostgres cmd
        )
    _ <- produceSolidVmEvents emittedEvents
    return ()

------ solidvmevents indexer code here ------
solidVmEventsTopicName :: TopicName
solidVmEventsTopicName = fromString "solidvmevents"

produceSolidVmEvents :: MonadIO m =>
                        [AggregateEvent] -> m [ProduceResponse]
produceSolidVmEvents = runKafkaMConfigured "slipstream" . produceItemsAsJSON solidVmEventsTopicName
