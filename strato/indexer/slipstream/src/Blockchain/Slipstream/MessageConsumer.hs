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
import Blockchain.Slipstream.Bus (BusPublisher (..))
import Blockchain.Slipstream.Metrics
import Blockchain.Slipstream.Processor
import Blockchain.Slipstream.OutputData
import Blockchain.Slipstream.SQL
import Blockchain.Strato.RedisBlockDB (runStratoRedisIO)
import qualified Blockchain.Stream.Action as A
import Blockchain.Stream.VMEvent (VMEvent (..))
import Blockchain.SyncDB (updateCirrusBestBlockNumber)
import Conduit
import Control.Monad
import Control.Monad.Composable.Streaming
import Control.Monad.Composable.SQL
-- import Data.String  -- UNUSED: was for solidvmevents
import Blockchain.Slipstream.PostgresqlTypedShim
import Data.Either (partitionEithers)
import Data.Foldable (for_)
import qualified Data.Text as T
import Prelude hiding (lookup)

getAndProcessMessages ::
  ( MonadLogger m,
    HasStreaming m,
    HasSQL m
  ) =>
  PGConnection ->
  Maybe BusPublisher ->
  m ()
getAndProcessMessages conn mBus = do
  -- createTopicAndWait solidVmEventsTopicName  -- UNUSED: no consumer

  consume "slipstream" "vmevents" $ \messages -> timeSlipstreamPhase "batch" $ do
    recordKafkaMessages messages
    let mTip = cirrusTip messages
    -- The progress upsert is appended as the batch's final query, so it
    -- lands in the last chunk and commits in the same transaction as the
    -- batch's final Cirrus writes: the marker never claims a block whose
    -- rows are still uncommitted.
    (emittedEvents, ()) <- runConduit $
      ((processTheMessages messages <* for_ mTip (yield . Right . cirrusProgressQuery)) `fuseUpstream` dedupC) `fuseBoth`
        sinkSlipstreamOutputChunks slipstreamOutputChunkSize (writeOutputChunk conn mBus)
    recordProcessedKafkaMessages messages
    -- Egress: the batch's events go out after everything above committed.
    for_ mBus $ \bus -> publishEvents bus emittedEvents
    -- Publish the high-water mark only after the conduit above has committed
    -- the batch's rows, so it never claims blocks Cirrus hasn't indexed yet.
    for_ mTip publishCirrusHighWaterMark
    return ()

writeOutputChunk ::
  (MonadLogger m, HasSQL m) =>
  PGConnection ->
  Maybe BusPublisher ->
  [SlipstreamQuery] ->
  [TransactionResult] ->
  m ()
writeOutputChunk conn mBus slipstreamQueries transactionResults = do
  recordOutputBatch slipstreamQueries transactionResults
  timeSlipstreamPhase "cirrus" $ performSlipstreamQueries conn slipstreamQueries
  unless (null transactionResults) $ do
    timeSlipstreamPhase "transaction_results" . void $ putTransactionResults transactionResults
    -- Results reach the bus only once Postgres has them.
    for_ mBus $ \bus -> publishResults bus transactionResults

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

-- | The highest block number a batch covers. vm-runner emits exactly one
-- NewAction per executed block (empty blocks included, see
-- sendNewActionMessage), so the max NewAction block number is the exact
-- Cirrus tip; batches with no NewAction carry no block information.
cirrusTip :: [VMEvent] -> Maybe Integer
cirrusTip messages =
  case [A._blockNumber a | NewAction a <- messages] of
    [] -> Nothing
    blockNumbers -> Just $ maximum blockNumbers

-- | Durable progress marker: upsert into @cirrus_progress@ (the
-- @CirrusProgress@ entity in CirrusTables.txt). Never moves backwards, so a
-- replayed batch cannot regress it.
cirrusProgressQuery :: Integer -> SlipstreamQuery
cirrusProgressQuery n =
  RawSQL $
    T.concat
      [ "INSERT INTO cirrus_progress (name, block_number) VALUES ('slipstream', ",
        T.pack (show n),
        ") ON CONFLICT (name) DO UPDATE SET block_number = GREATEST(cirrus_progress.block_number, EXCLUDED.block_number)"
      ]

-- | Record the Cirrus tip in Redis, where strato-api folds it into the
-- metadata isSynced flag. The Postgres row written by 'cirrusProgressQuery'
-- is the durable copy; this one is node-local.
publishCirrusHighWaterMark :: MonadIO m => Integer -> m ()
publishCirrusHighWaterMark = runStratoRedisIO . updateCirrusBestBlockNumber

------ solidvmevents indexer code here ------
-- UNUSED: no consumer for solidvmevents topic
-- solidVmEventsTopicName :: TopicName
-- solidVmEventsTopicName = fromString "solidvmevents"
--
-- produceSolidVmEvents :: MonadIO m =>
--                         [AggregateEvent] -> m [ProduceResponse]
-- produceSolidVmEvents = runStreamMConfigured "slipstream" . produceItemsAsJSON solidVmEventsTopicName
