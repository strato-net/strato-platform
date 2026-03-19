{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Strato.Indexer.ApiIndexer
  ( apiIndexerMainLoop,
    indexAPI,
    kafkaClientIds,
  )
where

import BlockApps.Logging
import Blockchain.Data.AddressStateDB (AddressState(..))
import Blockchain.Data.AddressStateRef (updateSQLBalanceAndNonce)
import Blockchain.DB.MemAddressStateDB (AddressStateModification(..))
import Blockchain.DB.SQLDB
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
import Control.Monad.Composable.Kafka
import qualified Data.Map.Strict as M
import qualified Data.Text as T

apiIndexerMainLoop :: ( MonadLogger m,
                        HasKafka m,
                        HasSQLDB m,
                        (Keccak256 `A.Alters` API OutputTx) m,
                        (Keccak256 `A.Alters` API OutputBlock) m
                      ) =>
                      m ()
apiIndexerMainLoop =
  consume "apiIndexer" (snd kafkaClientIds) targetTopicName $ \() idxEvents -> do
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
  let (txs, blocks, stateDiffs, asmUpdates) = filterHelper idxEvents
      insertCount = length blocks

  A.insertMany (A.Proxy @(API OutputTx)) . M.fromList $ (otHash &&& API) <$> txs

  $logInfoS "apiIndexer" . T.pack $ show insertCount ++ " of them are blocks"
  when (insertCount > 0) $ do
    $logInfoS "apiIndexer" . T.pack $ "  (inserting " ++ show insertCount ++ " output blocks)"
    A.insertMany (A.Proxy @(API OutputBlock)) . M.fromList $ (blockHash &&& API) <$> blocks

  when (not $ null stateDiffs) $ do
    $logInfoS "apiIndexer" . T.pack $ "Processing " ++ show (length stateDiffs) ++ " state diffs"
    mapM_ commitSqlDiffs stateDiffs

  when (not $ null asmUpdates) $ do
    $logInfoS "apiIndexer" . T.pack $ "Processing " ++ show (length asmUpdates) ++ " address state updates"
    mapM_ handleAddressStateUpdates asmUpdates
  where
    filterHelper :: [IndexEvent] -> ([OutputTx], [OutputBlock], [StateDiff], [M.Map Address AddressStateModification])
    filterHelper (indxEv : xs) =
      let (indexTransactions, ranBlocksLs, diffs, asms) = filterHelper xs
      in
        case indxEv of
          IndexTransaction _ tx -> (tx : indexTransactions, ranBlocksLs, diffs, asms)
          RanBlock b -> (indexTransactions, b : ranBlocksLs, diffs, asms)
          StateDiffEntry d -> (indexTransactions, ranBlocksLs, d : diffs, asms)
          AddressStateUpdates m -> (indexTransactions, ranBlocksLs, diffs, m : asms)
          _ -> (indexTransactions, ranBlocksLs, diffs, asms)
    filterHelper [] = ([], [], [], [])

    handleAddressStateUpdates :: HasSQLDB m => M.Map Address AddressStateModification -> m ()
    handleAddressStateUpdates asmMap =
      updateSQLBalanceAndNonce
        [ (addr, (addressStateBalance as, addressStateNonce as))
        | (addr, ASModification as) <- M.toList asmMap
        ]

kafkaClientIds :: (KafkaClientId, ConsumerGroup)
kafkaClientIds = ("strato-api-indexer", "strato-api-indexer")

{-
indexerMetadata :: Metadata
indexerMetadata = Metadata $ KString S8.empty
-}
