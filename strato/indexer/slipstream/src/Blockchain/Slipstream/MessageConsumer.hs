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
import Blockchain.Data.DataDefs (TransactionResult (..))
import Blockchain.Data.TransactionResult
import Blockchain.Strato.Model.Keccak256 (keccak256ToByteString, keccak256ToHex)
import qualified Strato.Tracing as Tr
import Blockchain.Data.WriterLease (LostWriterLease (..), holdsWriterLease)
import Blockchain.Slipstream.Data.CirrusTables
-- import Blockchain.EthConf  -- UNUSED: was for solidvmevents
-- import Blockchain.Slipstream.Data.Action (AggregateEvent)  -- UNUSED: was for solidvmevents
import Blockchain.Slipstream.Metrics
import Blockchain.Slipstream.Processor
import Blockchain.Slipstream.OutputData
import Blockchain.Slipstream.SQL
import Blockchain.Strato.RedisBlockDB (runStratoRedisIO)
import qualified Blockchain.Stream.Action as A
import Blockchain.Stream.VMEvent (VMEvent (..))
import Blockchain.SyncDB (updateCirrusBestBlockNumber)
import Conduit
import Control.Concurrent (threadDelay)
import Control.Monad
import Control.Monad.Composable.Streaming
import Control.Monad.Composable.SQL
import Data.Text (Text)
import Database.Persist.Postgresql (entityVal, getBy, runSqlPool)
-- import Data.String  -- UNUSED: was for solidvmevents
import Blockchain.Slipstream.PostgresqlTypedShim
import Data.Either (partitionEithers)
import Data.Foldable (for_)
import qualified Data.Text as T
import Prelude hiding (lookup)
import UnliftIO (throwIO)

-- | Consumes @vmevents@ forever. Only the cell holding the writer lease
-- writes Cirrus and transaction results; a standby follows the
-- writer through @cirrus_progress@, committing each batch's offset once the
-- writer has that batch's blocks, so a promoted cell resumes within a batch
-- of where the writer stopped.
getAndProcessMessages ::
  ( MonadLogger m,
    HasStreaming m,
    HasSQL m
  ) =>
  Text ->
  PGConnection ->
  m ()
getAndProcessMessages cell conn = do
  -- createTopicAndWait solidVmEventsTopicName  -- UNUSED: no consumer

  consume "slipstream" "vmevents" $ \messages -> do
    holds <- holdsWriterLease cell
    if holds
      then processBatch cell conn messages
      else case cirrusTip messages of
        -- No block in the batch (code collections, results). Returning
        -- would commit the offset past them, which is only right when some
        -- other writer applies them. A lone core (a monolith, or a single
        -- cell) starts slipstream before strato-indexer has claimed the
        -- lease, and dropping here would lose those results for good. So
        -- wait: either this cell gets the lease (the lone core, within
        -- seconds) or the writer's progress moves, which proves a writer
        -- consumed this batch before the block it just committed.
        Nothing -> do
          seen <- liftIO $ getCirrusProgress conn
          awaitWriter messages seen False
        Just tip -> follow messages tip False
  where
    awaitWriter messages seen logged = do
      holds <- holdsWriterLease cell
      if holds
        then do
          $logInfoS "slipstream" . T.pack $ "cell " ++ T.unpack cell ++ " holds the writer lease now; applying a batch without blocks"
          processBatch cell conn messages
        else do
          progress <- liftIO $ getCirrusProgress conn
          if progress > seen
            then return ()
            else do
              unless logged $
                $logInfoS "slipstream" . T.pack $
                  "no writer lease yet: holding a batch without blocks until this cell holds the lease or cirrus_progress moves past " ++ maybe "unset" show seen
              liftIO $ threadDelay 1000000
              awaitWriter messages seen True
    -- The batch may end with results and code collections of block tip+1,
    -- which vm-runner emits before that block's NewAction, so the writer has
    -- provably consumed every event in it only once its progress is past the
    -- tip; committing the offset earlier could skip them for good if this
    -- cell were promoted right then.
    follow messages tip logged = do
      progress <- liftIO $ getCirrusProgress conn
      if maybe False (> tip) progress
        then publishCirrusHighWaterMark tip
        else do
          holds <- holdsWriterLease cell
          if holds
            then do
              $logInfoS "slipstream" . T.pack $ "cell " ++ T.unpack cell ++ " holds the writer lease now; resuming Cirrus indexing at block " ++ show tip
              processBatch cell conn messages
            else do
              unless logged $
                $logInfoS "slipstream" . T.pack $
                  "standby: waiting for the writer to pass block " ++ show tip
                    ++ " (cirrus_progress is " ++ maybe "unset" show progress ++ ")"
              liftIO $ threadDelay 1000000
              follow messages tip True

-- | The current Cirrus tip, from the durable progress row.
getCirrusProgress :: PGConnection -> IO (Maybe Integer)
getCirrusProgress conn =
  fmap (cirrusProgressBlockNumber . entityVal)
    <$> runSqlPool (getBy (UniqueCirrusProgressName "slipstream")) conn

-- | Write a batch as the lease holder. Actions for blocks the cluster
-- already has (the first batch after a promotion, a redelivery after a
-- crash) are dropped; code collections and results are idempotent and stay.
processBatch ::
  ( MonadLogger m,
    HasStreaming m,
    HasSQL m
  ) =>
  Text ->
  PGConnection ->
  [VMEvent] ->
  m ()
processBatch cell conn allMessages = timeSlipstreamPhase "batch" $ do
    recordKafkaMessages allMessages
    progress <- liftIO $ getCirrusProgress conn
    let committed n = maybe False (>= n) progress
        keep (NewAction a) = not . committed $ A._blockNumber a
        keep _ = True
        messages = filter keep allMessages
        skipped = length allMessages - length messages
    when (skipped > 0) $
      $logInfoS "slipstream" . T.pack $
        "skipping " ++ show skipped ++ " actions at or below cirrus_progress " ++ maybe "unset" show progress
    let mTip = cirrusTip messages
        -- The genesis import is many NewActions for block 0 (one per
        -- account, see Bootstrap.populateStorageDBs) and can span several
        -- batches. Recording block 0 as committed after the first of them
        -- made the skip filter above drop the rest of the genesis accounts
        -- as "already applied": Cirrus came up missing hundreds of contracts
        -- and the genesis fields of others. Block 0 is therefore never
        -- recorded; the marker first moves once block 1 is applied, and a
        -- replayed genesis (vm-runner re-bootstraps on some restarts) is
        -- skipped from then on.
        mProgressTip = mTip >>= \tip -> if tip > 0 then Just tip else Nothing
    -- The progress upsert is appended as the batch's final query, so it
    -- lands in the last chunk and commits in the same transaction as the
    -- batch's final Cirrus writes: the marker never claims a block whose
    -- rows are still uncommitted.
    (_, ()) <- runConduit $
      ((processTheMessages messages <* for_ mProgressTip (yield . Right . cirrusProgressQuery)) `fuseUpstream` dedupC) `fuseBoth`
        sinkSlipstreamOutputChunks slipstreamOutputChunkSize (writeOutputChunk cell conn)
    recordProcessedKafkaMessages messages
    -- Publish the high-water mark only after the conduit above has committed
    -- the batch's rows, so it never claims blocks Cirrus hasn't indexed yet.
    for_ mTip publishCirrusHighWaterMark
    return ()

-- | Cirrus lives in its own database, so unlike strato-indexer's batch the
-- lease cannot be fenced inside the chunk's transaction (writer_lease is in
-- eth). The holder is re-read before every chunk instead, which bounds what
-- a demoted cell can still write to the chunk in flight (256 queries)
-- rather than the rest of a catch-up batch.
writeOutputChunk ::
  (MonadLogger m, HasSQL m) =>
  Text ->
  PGConnection ->
  [SlipstreamQuery] ->
  [TransactionResult] ->
  m ()
writeOutputChunk cell conn slipstreamQueries transactionResults = do
  holds <- holdsWriterLease cell
  unless holds $ throwIO (LostWriterLease cell)
  recordOutputBatch slipstreamQueries transactionResults
  timeSlipstreamPhase "cirrus" $ performSlipstreamQueries conn slipstreamQueries
  unless (null transactionResults) $ do
    started <- liftIO Tr.nowNanos
    timeSlipstreamPhase "transaction_results" . void $ putTransactionResults transactionResults
    liftIO $ recordResultSpans started transactionResults

-- | One "tx.result" span per result in the transaction's trace (its id
-- derives from the hash, as in strato-api's submit span): the moment the
-- transaction's outcome is durable and published, which closes the
-- submit-to-inclusion trace.
recordResultSpans :: Integer -> [TransactionResult] -> IO ()
recordResultSpans started results = do
  enabled <- Tr.tracingEnabled
  if not enabled
    then pure ()
    else do
      end <- Tr.nowNanos
      for_ results $ \r -> do
        let h = transactionResultTransactionHash r
            failed = case transactionResultMessage r of
              "Success!" -> Nothing
              m -> Just m
        Tr.recordSpan (Tr.traceIdFromHash (keccak256ToByteString h)) Nothing "tx.result" Tr.Consumer started end
          [ Tr.attrText "strato.tx_hash" (T.pack (keccak256ToHex h)),
            Tr.attrText "strato.block_hash" (T.pack (keccak256ToHex (transactionResultBlockHash r))),
            Tr.attrText "strato.stage" "slipstream",
            Tr.attrText "strato.result" (transactionResultMessage r)
          ]
          []
          failed

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
