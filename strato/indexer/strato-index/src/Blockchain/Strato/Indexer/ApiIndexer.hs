{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Strato.Indexer.ApiIndexer
  ( indexerMainLoop,
    SqlGroupReconciliation (..),
    reconcileSqlConsumerGroup,
    reconcileSqlConsumerGroupWith,
    awaitLeaseAndReconcile,
    awaitLeaseAndReconcileWith,
    retireSqlConsumerGroup,
    p2pConsumerGroup,
    sqlConsumerGroup,
    indexAPI,
    indexP2P,
    kafkaClientIds,
  )
where

import BlockApps.Logging
import Blockchain.Data.AddressStateDB (AddressState(..))
import Blockchain.Data.AddressStateRef (updateSQLBalanceAndNonceSql)
import Blockchain.Data.DataDefs (ReceiptRef (..))
import Blockchain.Data.BlockDB (putBlocksSql)
import Blockchain.Data.IndexerProgress (getIndexerProgress, setIndexerProgressSql)
import Blockchain.Data.WriterLease (LostWriterLease (..), describeLease, fenceWriterLeaseSql, getWriterLeaseSql, holdsWriterLease)
import qualified Blockchain.Data.BlockHeader as BH
import Blockchain.ChainMetrics (setBestBlockTimestamp)
import Blockchain.Data.ReceiptRef (putReceiptRefsSql)
import Blockchain.Data.Transaction (insertTX', transactionHash)
import Blockchain.DBM (DebugMode (..))
import Blockchain.DB.MemAddressStateDB (AddressStateModification(..))
import Blockchain.DB.SQLDB
import Blockchain.Model.SyncState
import Blockchain.Model.WrappedBlock
import Blockchain.Strato.Indexer.IContext
import Blockchain.Strato.Indexer.Kafka
import Blockchain.Strato.Indexer.Model
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Class (blockHash)
import Blockchain.Strato.StateDiff (StateDiff)
import qualified Blockchain.Strato.StateDiff as SD
import Blockchain.Strato.StateDiff.Database (commitSqlDiffsSql)
import Control.Concurrent (threadDelay)
import Control.Monad
import Data.Foldable (for_)
import Data.Maybe (isJust)
import Data.Text (Text)
import Data.Time.Clock (getCurrentTime)
import UnliftIO (MonadIO, liftIO, throwIO)
import UnliftIO.Exception (tryIO)
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Streaming
import qualified Data.Map.Strict as M
import qualified Data.Text as T
import Text.Format

-- | The one consumer group on the index events topic, the name the combined
-- indexer always used: one subscriber per cell writes the SQL side and then
-- the Redis best-block pointer, on every role that runs the chain.
p2pConsumerGroup :: ConsumerGroup
p2pConsumerGroup = "strato-indexer"

-- | The group the SQL side consumed under while the two sides were split
-- (19.6). Nothing consumes under it any more; see 'reconcileSqlConsumerGroup'.
sqlConsumerGroup :: ConsumerGroup
sqlConsumerGroup = "strato-indexer-sql"

-- | One consumer commits its offset only after both SQL and Redis indexing
-- finish. SQL retains the writer-lease checks and standby progress tracking.
indexerMainLoop :: ( MonadLogger m,
                     HasStreaming m,
                     HasSQLDB m,
                     Mod.Modifiable (P2P BestBlock) m
                   ) =>
                   Text ->
                   m ()
indexerMainLoop cell =
  consume p2pConsumerGroup targetTopicName $ \idxEvents -> do
    indexAPIGated cell idxEvents
    indexP2P idxEvents

-- | What 'reconcileSqlConsumerGroup' found and did.
data SqlGroupReconciliation
  = -- | The topic has no @strato-indexer-sql@ group: nothing to do.
    NoSqlGroup
  | -- | The group, its checkpoint and the segments it pins stay: this cell
    -- does not hold the writer lease, so its backlog cannot be replayed.
    SqlGroupKept
  | -- | The group's backlog (this many events) was replayed into SQL and the
    -- group retired.
    SqlGroupRetired Int
  | -- | The backlog could not be read (this error); the group and its
    -- segments stay, and the node goes on without them.
    SqlGroupUnreadable String
  deriving (Eq, Show)

-- | In 19.6 the SQL side consumed under its own group, 'sqlConsumerGroup',
-- and trailed the Redis side's 'p2pConsumerGroup' by whatever SQL had not
-- committed yet. A node upgraded in place, or restored from a snapshot of
-- that era (snapshots ship the whole jlog/ directory), still carries both
-- checkpoints. The unified consumer resumes from 'p2pConsumerGroup', so what
-- only the SQL group had not passed would never reach SQL: the block Redis
-- names as best would be missing from @block_data_ref@ and vm-runner would
-- wait for it for good. So, in this order: give 'p2pConsumerGroup' the SQL
-- group's checkpoint if it has none (a copy, nothing is deleted); then, only
-- while this cell holds the writer lease, replay the SQL group's backlog
-- through the SQL side alone (its writes are idempotent and the skip filter
-- drops what @indexer_progress@ already covers; Redis is not touched, its
-- best-block pointer must never move back) and retire the group, which also
-- sweeps the segments it alone was pinning. Without the lease nothing is
-- deleted: the checkpoint and its segments wait, since retiring them first
-- would lose the backlog for good. A backlog that cannot be read is kept
-- the same way, and the node goes on without it: a drain that throws would
-- otherwise take strato-indexer down on every start.
reconcileSqlConsumerGroup :: (MonadLogger m, HasStreaming m, HasSQLDB m) => Text -> m SqlGroupReconciliation
reconcileSqlConsumerGroup cell = reconcileSqlConsumerGroupWith (holdsWriterLease cell) (indexAPI cell)

-- | 'reconcileSqlConsumerGroup' with the lease check and the SQL writer
-- abstracted, so the decision can be exercised without Postgres.
reconcileSqlConsumerGroupWith :: (MonadLogger m, MonadUnliftIO m, HasStreaming m) => m Bool -> ([IndexEvent] -> m ()) -> m SqlGroupReconciliation
reconcileSqlConsumerGroupWith holdsLease writeSql = do
  present <- hasConsumerGroup sqlConsumerGroup targetTopicName
  if not present
    then return NoSqlGroup
    else do
      seeded <- seedConsumerGroupFrom p2pConsumerGroup sqlConsumerGroup targetTopicName
      when seeded $
        $logInfoS "reconcileSqlConsumerGroup" . T.pack $
          T.unpack p2pConsumerGroup ++ " had no checkpoint; it starts where " ++ T.unpack sqlConsumerGroup ++ " is"
      holds <- holdsLease
      if not holds
        then return SqlGroupKept
        else do
          $logInfoS "reconcileSqlConsumerGroup" . T.pack $
            "replaying what the obsolete " ++ T.unpack sqlConsumerGroup ++ " group had not consumed into SQL before retiring it"
          drained <- tryIO $ drainConsumerGroup sqlConsumerGroup targetTopicName writeSql
          case drained of
            Left err -> do
              $logWarnS "reconcileSqlConsumerGroup" . T.pack $
                "could not read the " ++ T.unpack sqlConsumerGroup ++ " backlog; keeping its checkpoint and the segments it pins: " ++ show err
              return (SqlGroupUnreadable (show err))
            Right n -> do
              $logInfoS "reconcileSqlConsumerGroup" . T.pack $
                "replayed " ++ show n ++ " index events from the " ++ T.unpack sqlConsumerGroup ++ " backlog into SQL"
              retireSqlConsumerGroup
              return (SqlGroupRetired n)

-- | 'reconcileSqlConsumerGroup', waiting for the writer lease first when a
-- previous process of this node still holds a fresh one (a container
-- recreated within 'staleAfterSeconds': the background claim succeeds once
-- that lease goes stale). A configured writer waits up to 60 s; a standby
-- (@--writer=false@) does not wait at all, its SQL is the writer's. Either
-- way, not holding the lease at the end keeps the group and everything it
-- pins, logged once, until the cell is next started as the writer.
awaitLeaseAndReconcile :: (MonadLogger m, HasStreaming m, HasSQLDB m) => Bool -> Text -> m SqlGroupReconciliation
awaitLeaseAndReconcile writer cell =
  awaitLeaseAndReconcileWith (if writer then 60 else 0) 1000000 (holdsWriterLease cell) whoHolds (indexAPI cell)
  where
    whoHolds = do
      lease <- sqlQueryWriter getWriterLeaseSql
      now <- liftIO getCurrentTime
      return (describeLease now lease)

-- | 'awaitLeaseAndReconcile' with the number of retries, their spacing (in
-- microseconds), the lease check, a description of the lease for the log,
-- and the SQL writer abstracted.
awaitLeaseAndReconcileWith :: (MonadLogger m, MonadUnliftIO m, HasStreaming m) => Int -> Int -> m Bool -> m String -> ([IndexEvent] -> m ()) -> m SqlGroupReconciliation
awaitLeaseAndReconcileWith retries intervalMicros holdsLease describeHolder writeSql = go retries False
  where
    go left announced = do
      outcome <- reconcileSqlConsumerGroupWith holdsLease writeSql
      case outcome of
        SqlGroupKept
          | left > 0 -> do
              unless announced $ do
                holder <- describeHolder
                $logInfoS "reconcileSqlConsumerGroup" . T.pack $
                  "this cell does not hold the writer lease yet (" ++ holder ++ "); waiting for it before replaying the " ++ T.unpack sqlConsumerGroup ++ " backlog"
              liftIO $ threadDelay intervalMicros
              go (left - 1) True
          | otherwise -> do
              holder <- describeHolder
              $logWarnS "reconcileSqlConsumerGroup" . T.pack $
                "this cell does not hold the writer lease (" ++ holder ++ "): keeping the " ++ T.unpack sqlConsumerGroup
                  ++ " checkpoint and the segments it pins until it is started as the writer (its backlog is not in SQL yet)"
              return outcome
        _ -> return outcome

-- | Drop the obsolete SQL group's checkpoint, and the segments it alone was
-- pinning. Only after 'reconcileSqlConsumerGroup' has replayed its backlog:
-- JLog sweeps what no remaining subscriber needs.
retireSqlConsumerGroup :: (MonadLogger m, HasStreaming m) => m ()
retireSqlConsumerGroup = do
  removed <- removeConsumerGroup sqlConsumerGroup targetTopicName
  when removed $
    $logInfoS "retireSqlConsumerGroup" . T.pack $
      "retired the obsolete " ++ T.unpack sqlConsumerGroup ++ " consumer group on " ++ T.unpack (unTopicName targetTopicName) ++ " (the SQL side consumes under " ++ T.unpack p2pConsumerGroup ++ ")"

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
    HasSQLDB m
  ) =>
  Text ->
  [IndexEvent] ->
  m ()
indexAPIGated cell idxEvents = do
  holds <- holdsWriterLease cell
  if holds
    then indexAPI cell idxEvents
    else case batchTip idxEvents of
      -- Nothing block-bound in this batch (transactions, balance updates).
      -- Returning would commit the offset past them, which is only right
      -- when another writer applies them. A lone core can reach here before
      -- its own strato-indexer claims the lease, so wait until this cell
      -- holds it or the writer's progress moves (proof a writer consumed
      -- this batch before the block it just committed).
      Nothing -> do
        seen <- getIndexerProgress
        awaitWriter seen False
      Just tip -> follow tip False
  where
    awaitWriter seen logged = do
      holds <- holdsWriterLease cell
      if holds
        then do
          $logInfoS "apiIndexer" . T.pack $ "cell " ++ T.unpack cell ++ " holds the writer lease now; applying a batch without blocks"
          indexAPI cell idxEvents
        else do
          progress <- getIndexerProgress
          if progress > seen
            then return ()
            else do
              unless logged $
                $logInfoS "apiIndexer" . T.pack $
                  "no writer lease yet: holding a batch without blocks until this cell holds the lease or indexer_progress moves past " ++ maybe "unset" show seen
              liftIO $ threadDelay 1000000
              awaitWriter seen True
    -- The batch may end with events of block tip+1 that precede its RanBlock
    -- (vm-runner emits a block's transactions and results before the block
    -- itself), so the writer has provably consumed every event in it only
    -- once its progress is past the tip; committing the offset earlier could
    -- skip those events for good if this cell were promoted right then.
    follow tip logged = do
      progress <- getIndexerProgress
      if maybe False (> tip) progress
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
    HasSQLDB m
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
      signers = M.fromList
        [(transactionHash tx, signer) | block <- blocks, OutputTx {otBaseTx = tx, otSigner = signer} <- obReceiptTransactions block]
      insertCount = length blocks
      -- vm-runner yields NewBestBlock only after a batch's RanBlocks and
      -- their state diffs (BlockChain.addBlocks), so the highest one in this
      -- batch bounds the blocks whose index events are all in hand.
      mProgress = case [n | NewBestBlock (_, n) <- idxEvents] of
        [] -> Nothing
        ns -> Just $ maximum ns

  $logInfoS "apiIndexer" . T.pack $ show insertCount ++ " of them are blocks"
  when (insertCount > 0) $
    $logInfoS "apiIndexer" . T.pack $ "  (inserting " ++ show insertCount ++ " output blocks)"
  when (not $ null receiptRefs) $
    $logInfoS "apiIndexer" . T.pack $ "Processing " ++ show (length receiptRefs) ++ " receipt rows"
  when (not $ null stateDiffs) $
    $logInfoS "apiIndexer" . T.pack $ "Processing " ++ show (length stateDiffs) ++ " state diffs"

  when (not $ null asmUpdates) $
    $logInfoS "apiIndexer" . T.pack $ "Processing " ++ show (length asmUpdates) ++ " address state updates"

  -- One transaction per batch: transactions, blocks, receipts, state diffs,
  -- balance updates and the progress marker commit together, so
  -- indexer_progress never names a block whose rows are missing and a crash
  -- mid-batch leaves nothing half-applied. Every write inside is idempotent,
  -- so the at-least-once redelivery after a crash (offsets commit only after
  -- this handler returns) is safe.
  when (not (null txs) || not (null blocks) || not (null receiptRefs) || not (null stateDiffs) || not (null asmUpdates) || isJust mProgress) $
    sqlQueryWriter $ do
      -- Fence: the lease row is re-asserted (and row-locked) inside this
      -- transaction, so a cell that was demoted cannot commit a late batch.
      now <- liftIO getCurrentTime
      fenced <- fenceWriterLeaseSql cell now
      unless fenced $ throwIO (LostWriterLease cell)
      -- API-submitted transactions already have a row (block_number -1,
      -- written by strato-api); insertTX' skips those by hash.
      forM_ txs $ \OutputTx {..} -> insertTX' Fail otOrigin Nothing now [otBaseTx]
      unless (null blocks) . void $ putBlocksSql signers (outputBlockToBlockRetainPayloads <$> blocks) False
      putReceiptRefsSql receiptRefs
      mapM_ commitSqlDiffsSql stateDiffs
      mapM_ (updateSQLBalanceAndNonceSql . addressStateUpdates) asmUpdates
      for_ mProgress setIndexerProgressSql
      -- The row lock above holds the heartbeat thread off until this commits,
      -- so stamp the heartbeat again now: a long catch-up batch must not
      -- leave a live writer looking stale (and so claimable) at its end.
      end <- liftIO getCurrentTime
      void $ fenceWriterLeaseSql cell end
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

    addressStateUpdates :: M.Map Address AddressStateModification -> [(Address, (Integer, Integer))]
    addressStateUpdates asmMap =
      [ (addr, (addressStateBalance as, addressStateNonce as))
      | (addr, ASModification as) <- M.toList asmMap
      ]

kafkaClientIds :: (ClientId, ConsumerGroup)
kafkaClientIds = ("strato-api-indexer", "strato-api-indexer")

-- | P2P indexing: writes blocks to Redis for P2P sync
indexP2P ::
  ( MonadLogger m,
    MonadIO m,
    Mod.Modifiable (P2P BestBlock) m
  ) =>
  [IndexEvent] ->
  m ()
indexP2P idxEvents = do
  forM_ idxEvents $ \case
    NewBestBlock (sha, num) -> do
      $logInfoS "p2pIndexer" . T.pack $
        "Updating RedisBestBlock as (" ++ format sha ++ ", " ++ show num ++ ")"
      Mod.put (Mod.Proxy @(P2P BestBlock)) . P2P $ BestBlock sha num
      -- Block age for the chain-health gauges: the header of the block that
      -- just became best is in this batch.
      for_ [b | RanBlock b _ <- idxEvents, blockHash b == sha] $
        setBestBlockTimestamp . BH.timestamp . obBlockData
    _ -> return ()
