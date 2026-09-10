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
import Blockchain.Data.ReceiptRef (putReceiptRefs)
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
import Blockchain.Strato.StateDiff.Database (commitSqlDiffs)
import Control.Arrow ((&&&))
import Control.Monad
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
                     (Keccak256 `A.Alters` API OutputBlock) m,
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
                        (Keccak256 `A.Alters` API OutputTx) m,
                        (Keccak256 `A.Alters` API OutputBlock) m
                      ) =>
                      m ()
apiIndexerMainLoop =
  consume (snd kafkaClientIds) targetTopicName $ \idxEvents -> do
    indexAPI idxEvents
    return ()

indexAPI ::
  ( MonadLogger m,
    HasSQLDB m,
    (Keccak256 `A.Alters` API OutputTx) m,
    (Keccak256 `A.Alters` API OutputBlock) m
  ) =>
  [IndexEvent] ->
  m ()
indexAPI idxEvents = do
  let (txs, blocks, receiptRefs, stateDiffs, asmUpdates) = filterHelper idxEvents
      insertCount = length blocks

  A.insertMany (A.Proxy @(API OutputTx)) . M.fromList $ (otHash &&& API) <$> txs

  $logInfoS "apiIndexer" . T.pack $ show insertCount ++ " of them are blocks"
  when (insertCount > 0) $ do
    $logInfoS "apiIndexer" . T.pack $ "  (inserting " ++ show insertCount ++ " output blocks)"
    A.insertMany (A.Proxy @(API OutputBlock)) . M.fromList $ (blockHash &&& API) <$> blocks

  when (not $ null receiptRefs) $ do
    $logInfoS "apiIndexer" . T.pack $
      "Processing " ++ show (length receiptRefs) ++ " receipt rows"
    putReceiptRefs receiptRefs

  when (not $ null stateDiffs) $ do
    $logInfoS "apiIndexer" . T.pack $ "Processing " ++ show (length stateDiffs) ++ " state diffs"
    mapM_ commitSqlDiffs stateDiffs

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
