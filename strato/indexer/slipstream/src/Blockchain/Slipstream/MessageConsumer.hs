{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}

{-# OPTIONS -fno-warn-deprecations #-}

module Blockchain.Slipstream.MessageConsumer
  ( getAndProcessMessages,
    sinkSlipstreamOutputChunks,
    slipstreamOutputChunkSize,
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
import Data.Either (partitionEithers)
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

  consume "slipstream" "vmevents" $ \messages -> timeSlipstreamPhase "batch" $ do
    recordKafkaMessages messages
    (_emittedEvents, ()) <- runConduit $
      (processTheMessages messages `fuseUpstream` dedupC) `fuseBoth`
        sinkSlipstreamOutputChunks slipstreamOutputChunkSize (writeOutputChunk conn)
    recordProcessedKafkaMessages messages
    -- _ <- produceSolidVmEvents _emittedEvents  -- UNUSED: no consumer for solidvmevents
    return ()

writeOutputChunk ::
  (MonadLogger m, HasSQL m) =>
  PGConnection ->
  [SlipstreamQuery] ->
  [TransactionResult] ->
  m ()
writeOutputChunk conn slipstreamQueries transactionResults = do
  recordOutputBatch slipstreamQueries transactionResults
  timeSlipstreamPhase "cirrus" $ performSlipstreamQueries conn slipstreamQueries
  unless (null transactionResults) $
    timeSlipstreamPhase "transaction_results" . void $ putTransactionResults transactionResults

sinkSlipstreamOutputChunks ::
  MonadIO m =>
  Int ->
  ([SlipstreamQuery] -> [TransactionResult] -> m ()) ->
  ConduitM (Either TransactionResult SlipstreamQuery) o m ()
sinkSlipstreamOutputChunks chunkSize writeChunk = go
  where
    go = do
      outputs <- timeSlipstreamPhase "transform" $ awaitChunk chunkSize
      unless (null outputs) $ do
        let (transactionResults, slipstreamQueries) = partitionEithers outputs
        lift $ writeChunk slipstreamQueries transactionResults
        go

    awaitChunk size | size <= 0 = error "sinkSlipstreamOutputChunks: chunk size must be positive"
    awaitChunk size = collect size []

    collect 0 outputs = pure $ reverse outputs
    collect remaining outputs =
      await >>= \case
        Nothing -> pure $ reverse outputs
        Just output -> collect (remaining - 1) (output : outputs)

slipstreamOutputChunkSize :: Int
slipstreamOutputChunkSize = 256

------ solidvmevents indexer code here ------
-- UNUSED: no consumer for solidvmevents topic
-- solidVmEventsTopicName :: TopicName
-- solidVmEventsTopicName = fromString "solidvmevents"
--
-- produceSolidVmEvents :: MonadIO m =>
--                         [AggregateEvent] -> m [ProduceResponse]
-- produceSolidVmEvents = runStreamMConfigured "slipstream" . produceItemsAsJSON solidVmEventsTopicName
