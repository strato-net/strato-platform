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
-- import Blockchain.EthConf  -- UNUSED: was for solidvmevents
-- import Blockchain.Slipstream.Data.Action (AggregateEvent)  -- UNUSED: was for solidvmevents
import Blockchain.Slipstream.Metrics
import Blockchain.Slipstream.Processor
import Blockchain.Slipstream.OutputData
import Blockchain.Slipstream.SQL
import Conduit
import Control.Monad
import Control.Monad.Composable.Streaming
import Control.Monad.Composable.SQL
-- import Data.String  -- UNUSED: was for solidvmevents
import Blockchain.Slipstream.PostgresqlTypedShim
import Prelude hiding (lookup)

getAndProcessMessages ::
  ( MonadLogger m,
    HasStreaming m,
    HasSQL m
  ) =>
  PGConnection ->
  m ()
getAndProcessMessages conn = do
  -- createTopicAndWait solidVmEventsTopicName  -- UNUSED: no consumer

  consume "slipstream" "vmevents" $ \messages -> do
    recordKafkaMessages messages
    _emittedEvents <- runConduit $
      processTheMessages messages `fuseUpstream`
        dedupC `fuseUpstream`
        awaitForever (\case
          Left txr -> void . lift $ putTransactionResult txr
          Right cmd -> lift $ case cmd of
            InsertDelegatecall dc -> insertDelegatecallPostgres conn dc
            _ -> dbQueryCatchError conn $ slipstreamQueryPostgres cmd
        )
    -- _ <- produceSolidVmEvents _emittedEvents  -- UNUSED: no consumer for solidvmevents
    return ()

------ solidvmevents indexer code here ------
-- UNUSED: no consumer for solidvmevents topic
-- solidVmEventsTopicName :: TopicName
-- solidVmEventsTopicName = fromString "solidvmevents"
--
-- produceSolidVmEvents :: MonadIO m =>
--                         [AggregateEvent] -> m [ProduceResponse]
-- produceSolidVmEvents = runStreamMConfigured "slipstream" . produceItemsAsJSON solidVmEventsTopicName
