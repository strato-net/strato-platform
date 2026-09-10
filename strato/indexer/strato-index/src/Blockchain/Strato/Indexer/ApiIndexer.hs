{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Strato.Indexer.ApiIndexer
  ( apiIndexerMainLoop,
    indexerMainLoop,
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
import Blockchain.Data.IndexerProgress (setIndexerProgressSql)
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
import Blockchain.Strato.StateDiff.Database (commitSqlDiffsSql)
import Control.Arrow ((&&&))
import Control.Monad
import Data.Foldable (for_)
import Data.Maybe (isJust)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Streaming
import qualified Data.Map.Strict as M
import qualified Data.Text as T
import Text.Format

-- | Combined indexer: processes events for both SQL (API) and Redis (P2P)
indexerMainLoop :: ( MonadLogger m,
                     HasStreaming m,
                     HasSQLDB m,
                     (Keccak256 `A.Alters` API OutputTx) m,
                     (Keccak256 `A.Alters` P2P OutputBlock) m,
                     Mod.Modifiable (P2P BestBlock) m
                   ) =>
                   m ()
indexerMainLoop =
  consume "strato-indexer" targetTopicName $ \idxEvents -> do
    indexAPI idxEvents
    indexP2P idxEvents

-- | Legacy entry point for API-only indexing
apiIndexerMainLoop :: ( MonadLogger m,
                        HasStreaming m,
                        HasSQLDB m,
                        (Keccak256 `A.Alters` API OutputTx) m
                      ) =>
                      m ()
apiIndexerMainLoop =
  consume (snd kafkaClientIds) targetTopicName $ \idxEvents -> do
    indexAPI idxEvents
    return ()

indexAPI ::
  ( MonadLogger m,
    HasSQLDB m,
    (Keccak256 `A.Alters` API OutputTx) m
  ) =>
  [IndexEvent] ->
  m ()
indexAPI idxEvents = do
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
    sqlQuery $ do
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
    _ -> return ()
