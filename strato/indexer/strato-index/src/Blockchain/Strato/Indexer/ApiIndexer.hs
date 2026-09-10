{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Strato.Indexer.ApiIndexer
  ( p2pIndexerLoop,
    sqlIndexerLoop,
    seedSqlConsumerGroup,
    p2pConsumerGroup,
    sqlConsumerGroup,
    indexAPI,
    indexP2P,
    kafkaClientIds,
  )
where

import BlockApps.Logging
import Blockchain.Data.AddressStateDB (AddressState(..))
import Blockchain.Data.AddressStateRef (updateSQLBalanceAndNonce)
import Blockchain.Data.DataDefs (ReceiptRef (..))
import Blockchain.Data.BlockDB (putBlocksSql)
import Blockchain.Data.IndexerProgress (getIndexerProgress, setIndexerProgressSql)
import Blockchain.Data.WriterLease (LostWriterLease (..), fenceWriterLeaseSql, holdsWriterLease)
import qualified Blockchain.Data.BlockHeader as BH
import Blockchain.ChainMetrics (setBestBlockTimestamp)
import Blockchain.Data.ReceiptRef (putReceiptRefsSql)
import Blockchain.DB.MemAddressStateDB (AddressStateModification(..))
import Blockchain.DB.SQLDB
import Blockchain.Model.SyncState
import Blockchain.Model.WrappedBlock
import Blockchain.Strato.Indexer.IContext
import Blockchain.Strato.Indexer.Kafka
import Blockchain.Strato.Indexer.Model
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Class (blockHash)
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.StateDiff (StateDiff)
import qualified Blockchain.Strato.StateDiff as SD
import Blockchain.Strato.StateDiff.Database (commitSqlDiffsSql)
import Control.Arrow ((&&&))
import Control.Concurrent (threadDelay)
import Control.Monad
import Data.Foldable (for_)
import Data.Maybe (isJust, isNothing)
import Data.Text (Text)
import Data.Time.Clock (getCurrentTime)
import UnliftIO (MonadIO, liftIO, throwIO)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Streaming
import qualified Data.Map.Strict as M
import qualified Data.Text as T
import Text.Format

-- | The Redis side, per cell, under the consumer group the combined indexer
-- always used. strato-p2p serves blocks from this Redis, so it runs on every
-- core whether or not the core writes Postgres.
p2pConsumerGroup :: ConsumerGroup
p2pConsumerGroup = "strato-indexer"

-- | The SQL side's own consumer group, so a standby core can trail the
-- writer's progress without holding up its Redis side, and a promoted core
-- resumes exactly where its trailing left off.
sqlConsumerGroup :: ConsumerGroup
sqlConsumerGroup = "strato-indexer-sql"

p2pIndexerLoop :: ( MonadLogger m,
                    HasStreaming m,
                    (Keccak256 `A.Alters` P2P OutputBlock) m,
                    Mod.Modifiable (P2P BestBlock) m
                  ) =>
                  m ()
p2pIndexerLoop = consume p2pConsumerGroup targetTopicName indexP2P

-- | The SQL side. Writes only while this cell holds the writer lease;
-- otherwise it follows the writer through @indexer_progress@, committing
-- each batch's offset once the writer has that batch's blocks, so promotion
-- picks up within seconds of where the writer stopped.
sqlIndexerLoop :: ( MonadLogger m,
                    HasStreaming m,
                    HasSQLDB m,
                    (Keccak256 `A.Alters` API OutputTx) m
                  ) =>
                  Text ->
                  m ()
sqlIndexerLoop cell = consume sqlConsumerGroup targetTopicName (indexAPIGated cell)

-- | On the first run after the SQL side got its own group, start it from the
-- combined group's offset rather than from the beginning of retention.
seedSqlConsumerGroup :: HasStreaming m => m ()
seedSqlConsumerGroup = do
  existing <- lookupKafkaCheckpoint sqlConsumerGroup targetTopicName
  when (isNothing existing) $ do
    legacy <- lookupKafkaCheckpoint p2pConsumerGroup targetTopicName
    for_ legacy $ setKafkaCheckpoint sqlConsumerGroup targetTopicName

-- | The highest block number a batch carries, if it carries any.
batchTip :: [IndexEvent] -> Maybe Integer
batchTip idxEvents =
  case [BH.number (obBlockData b) | RanBlock b _ <- idxEvents]
    ++ [n | NewBestBlock (_, n) <- idxEvents]
    ++ [SD.blockNumber d | StateDiffEntry d <- idxEvents] of
    [] -> Nothing
    ns -> Just $ maximum ns

indexAPIGated ::
  ( MonadLogger m,
    HasSQLDB m,
    (Keccak256 `A.Alters` API OutputTx) m
  ) =>
  Text ->
  [IndexEvent] ->
  m ()
indexAPIGated cell idxEvents = do
  holds <- holdsWriterLease cell
  if holds
    then indexAPI cell idxEvents
    else case batchTip idxEvents of
      -- Nothing block-bound in this batch (transactions, balance updates):
      -- the writer applies those; returning commits the offset past them.
      Nothing -> return ()
      Just tip -> follow tip False
  where
    follow tip logged = do
      progress <- getIndexerProgress
      if maybe False (>= tip) progress
        then return ()
        else do
          holds <- holdsWriterLease cell
          if holds
            then do
              $logInfoS "apiIndexer" . T.pack $ "cell " ++ T.unpack cell ++ " holds the writer lease now; resuming SQL indexing at block " ++ show tip
              indexAPI cell idxEvents
            else do
              unless logged $
                $logInfoS "apiIndexer" . T.pack $
                  "standby: waiting for the writer to pass block " ++ show tip
                    ++ " (indexer_progress is " ++ maybe "unset" show progress ++ ")"
              liftIO $ threadDelay 1000000
              follow tip True

indexAPI ::
  ( MonadLogger m,
    HasSQLDB m,
    (Keccak256 `A.Alters` API OutputTx) m
  ) =>
  Text ->
  [IndexEvent] ->
  m ()
indexAPI cell allEvents = do
  -- Skip filter: blocks, diffs and best-block marks the cluster already
  -- holds are dropped, which happens on the first batch after a promotion
  -- (the standby trailed by up to one batch) and on redelivery after a
  -- crash. Transactions and balance updates stay: they are idempotent, and
  -- in topic order they converge on the same latest value.
  progress <- getIndexerProgress
  let committed n = maybe False (>= n) progress
      keep (RanBlock b _) = not . committed $ BH.number (obBlockData b)
      keep (StateDiffEntry d) = not . committed $ SD.blockNumber d
      keep (NewBestBlock (_, n)) = not $ committed n
      keep _ = True
      idxEvents = filter keep allEvents
      skipped = length allEvents - length idxEvents
  when (skipped > 0) $
    $logInfoS "apiIndexer" . T.pack $
      "skipping " ++ show skipped ++ " events at or below indexer_progress " ++ maybe "unset" show progress
  let (txs, blocks, receiptRefs, stateDiffs, asmUpdates) = filterHelper idxEvents
      insertCount = length blocks
      -- vm-runner yields NewBestBlock only after a batch's RanBlocks and
      -- their state diffs (BlockChain.addBlocks), so the highest one in this
      -- batch bounds the blocks whose index events are all in hand.
      mProgress = case [n | NewBestBlock (_, n) <- idxEvents] of
        [] -> Nothing
        ns -> Just $ maximum ns

  A.insertMany (A.Proxy @(API OutputTx)) . M.fromList $ (otHash &&& API) <$> txs

  $logInfoS "apiIndexer" . T.pack $ show insertCount ++ " of them are blocks"
  when (insertCount > 0) $
    $logInfoS "apiIndexer" . T.pack $ "  (inserting " ++ show insertCount ++ " output blocks)"
  when (not $ null receiptRefs) $
    $logInfoS "apiIndexer" . T.pack $ "Processing " ++ show (length receiptRefs) ++ " receipt rows"
  when (not $ null stateDiffs) $
    $logInfoS "apiIndexer" . T.pack $ "Processing " ++ show (length stateDiffs) ++ " state diffs"

  -- One transaction per batch: blocks, receipts, state diffs and the progress
  -- marker commit together, so indexer_progress never names a block whose
  -- rows are missing and a crash mid-batch leaves nothing half-applied. Every
  -- write inside is idempotent, so the at-least-once redelivery after a crash
  -- (offsets commit only after this handler returns) is safe.
  when (not (null blocks) || not (null receiptRefs) || not (null stateDiffs) || isJust mProgress) $
    sqlQueryWriter $ do
      -- Fence: the lease row is re-asserted (and row-locked) inside this
      -- transaction, so a cell that was demoted cannot commit a late batch.
      now <- liftIO getCurrentTime
      fenced <- fenceWriterLeaseSql cell now
      unless fenced $ throwIO (LostWriterLease cell)
      unless (null blocks) . void $ putBlocksSql (outputBlockToBlockRetainPayloads <$> blocks) False
      putReceiptRefsSql receiptRefs
      mapM_ commitSqlDiffsSql stateDiffs
      for_ mProgress setIndexerProgressSql

  when (not $ null asmUpdates) $ do
    $logInfoS "apiIndexer" . T.pack $ "Processing " ++ show (length asmUpdates) ++ " address state updates"
    mapM_ handleAddressStateUpdates asmUpdates
  where
    filterHelper ::
      [IndexEvent] ->
      ( [OutputTx],
        [OutputBlock],
        [ReceiptRef],
        [StateDiff],
        [M.Map Address AddressStateModification]
      )
    filterHelper (indxEv : xs) =
      let (indexTransactions, ranBlocksLs, recRefs, diffs, asms) = filterHelper xs
      in
        case indxEv of
          IndexTransaction _ tx -> (tx : indexTransactions, ranBlocksLs, recRefs, diffs, asms)
          RanBlock b receiptsBytes ->
            let bh = blockHash b
                newRefs =
                  [ ReceiptRef bh i bytes
                  | (i, bytes) <- zip [0 ..] receiptsBytes
                  ]
             in (indexTransactions, b : ranBlocksLs, newRefs ++ recRefs, diffs, asms)
          StateDiffEntry d -> (indexTransactions, ranBlocksLs, recRefs, d : diffs, asms)
          AddressStateUpdates m -> (indexTransactions, ranBlocksLs, recRefs, diffs, m : asms)
          _ -> (indexTransactions, ranBlocksLs, recRefs, diffs, asms)
    filterHelper [] = ([], [], [], [], [])

    handleAddressStateUpdates :: HasSQLDB m => M.Map Address AddressStateModification -> m ()
    handleAddressStateUpdates asmMap =
      updateSQLBalanceAndNonce
        [ (addr, (addressStateBalance as, addressStateNonce as))
        | (addr, ASModification as) <- M.toList asmMap
        ]

kafkaClientIds :: (ClientId, ConsumerGroup)
kafkaClientIds = ("strato-api-indexer", "strato-api-indexer")

-- | P2P indexing: writes blocks to Redis for P2P sync
indexP2P ::
  ( MonadLogger m,
    MonadIO m,
    (Keccak256 `A.Alters` P2P OutputBlock) m,
    Mod.Modifiable (P2P BestBlock) m
  ) =>
  [IndexEvent] ->
  m ()
indexP2P idxEvents = do
  forM_ idxEvents $ \case
    RanBlock b _receipts -> do
      $logInfoS "p2pIndexer" . T.pack $ "Inserting Redis block with sha: " ++ format (blockHash b)
      A.insert (A.Proxy @(P2P OutputBlock)) (blockHash b) $ P2P b
    NewBestBlock (sha, num) -> do
      $logInfoS "p2pIndexer" . T.pack $
        "Updating RedisBestBlock as (" ++ format sha ++ ", " ++ show num ++ ")"
      Mod.put (Mod.Proxy @(P2P BestBlock)) . P2P $ BestBlock sha num
      -- Block age for the chain-health gauges: the header of the block that
      -- just became best is in this batch.
      for_ [b | RanBlock b _ <- idxEvents, blockHash b == sha] $
        setBestBlockTimestamp . BH.timestamp . obBlockData
    _ -> return ()
