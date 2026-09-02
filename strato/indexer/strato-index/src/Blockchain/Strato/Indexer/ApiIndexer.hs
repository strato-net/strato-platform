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
import Blockchain.Data.DataDefs
  ( AddressStateRef (..),
    EntityField
      ( AddressStateRefAddress,
        AddressStateRefBalance,
        AddressStateRefCodeHash,
        AddressStateRefContractName,
        AddressStateRefContractRoot,
        AddressStateRefId,
        AddressStateRefLatestBlockDataRefNumber,
        AddressStateRefNonce,
        StorageAddressStateRefId
      ),
    CodeRef (..),
    ReceiptRef (..),
    Storage (..),
  )
import Blockchain.Data.ReceiptRef (putReceiptRefs)
import Blockchain.Data.Transaction (codePtrHash, codePtrName)
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
import Data.List (foldl')
import qualified Data.Map.Strict as M
import Data.Maybe (mapMaybe)
import qualified Data.Set as S
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8)
import qualified Database.Persist.Postgresql as SQL hiding (Update, get)
import SolidVM.Model.Storable (BasicValue (BDefault))
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
  let (txs, blocks, receiptRefs, stateDiffs, asmUpdates, stateUpdates) = filterHelper idxEvents
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

  when (not $ null stateUpdates) $ do
    $logInfoS "apiIndexer" . T.pack $ "Processing " ++ show (length stateUpdates) ++ " direct state updates"
    commitStateUpdates stateUpdates
  where
    filterHelper ::
      [IndexEvent] ->
      ( [OutputTx],
        [OutputBlock],
        [ReceiptRef],
        [StateDiff],
        [M.Map Address AddressStateModification],
        [StateUpdates]
      )
    filterHelper (indxEv : xs) =
      let (indexTransactions, ranBlocksLs, recRefs, diffs, asms, updates) = filterHelper xs
      in
        case indxEv of
          IndexTransaction _ tx -> (tx : indexTransactions, ranBlocksLs, recRefs, diffs, asms, updates)
          RanBlock b receiptsBytes ->
            let bh = blockHash b
                newRefs =
                  [ ReceiptRef bh i bytes
                  | (i, bytes) <- zip [0 ..] receiptsBytes
                  ]
             in (indexTransactions, b : ranBlocksLs, newRefs ++ recRefs, diffs, asms, updates)
          StateDiffEntry d -> (indexTransactions, ranBlocksLs, recRefs, d : diffs, asms, updates)
          AddressStateUpdates m -> (indexTransactions, ranBlocksLs, recRefs, diffs, m : asms, updates)
          StateUpdatesEntry u -> (indexTransactions, ranBlocksLs, recRefs, diffs, asms, u : updates)
          _ -> (indexTransactions, ranBlocksLs, recRefs, diffs, asms, updates)
    filterHelper [] = ([], [], [], [], [], [])

    handleAddressStateUpdates :: HasSQLDB m => M.Map Address AddressStateModification -> m ()
    handleAddressStateUpdates asmMap =
      updateSQLBalanceAndNonce
        [ (addr, (addressStateBalance as, addressStateNonce as))
        | (addr, ASModification as) <- M.toList asmMap
        ]

commitStateUpdates :: (MonadLogger m, HasSQLDB m) => [StateUpdates] -> m ()
commitStateUpdates updates =
  sqlQuery $ do
    forM_ (M.toList codeUpdates) $ \(codeHash, codeBytes) ->
      void $ SQL.upsert (CodeRef codeHash $ decodeUtf8 codeBytes) []

    deletedEntities <-
      if null deletedAddresses
        then pure []
        else SQL.selectList [AddressStateRefAddress SQL.<-. deletedAddresses] []
    let deletedAddressIds = SQL.entityKey <$> deletedEntities
    unless (null deletedAddressIds) $ do
      SQL.deleteWhere [StorageAddressStateRefId SQL.<-. deletedAddressIds]
      SQL.deleteWhere [AddressStateRefId SQL.<-. deletedAddressIds]

    modifiedAddressIds <- fmap M.fromList . forM modifiedAddresses $ \(address, blockNumber, addressState) -> do
      let codePtr = addressStateCodeHash addressState
          addressRef =
            AddressStateRef
              { addressStateRefAddress = address,
                addressStateRefNonce = addressStateNonce addressState,
                addressStateRefBalance = addressStateBalance addressState,
                addressStateRefContractRoot = addressStateContractRoot addressState,
                addressStateRefCodeHash = codePtrHash codePtr,
                addressStateRefContractName = codePtrName codePtr,
                addressStateRefLatestBlockDataRefNumber = blockNumber
              }
      addressEntity <-
        SQL.upsert
          addressRef
          [ AddressStateRefNonce SQL.=. addressStateNonce addressState,
            AddressStateRefBalance SQL.=. addressStateBalance addressState,
            AddressStateRefContractRoot SQL.=. addressStateContractRoot addressState,
            AddressStateRefCodeHash SQL.=. codePtrHash codePtr,
            AddressStateRefContractName SQL.=. codePtrName codePtr,
            AddressStateRefLatestBlockDataRefNumber SQL.=. blockNumber
          ]
      pure (address, SQL.entityKey addressEntity)

    let missingStorageAddresses =
          S.toList $
            M.keysSet storageUpdates `S.difference` M.keysSet modifiedAddressIds
    existingAddressEntities <-
      if null missingStorageAddresses
        then pure []
        else SQL.selectList [AddressStateRefAddress SQL.<-. missingStorageAddresses] []
    let addressIds =
          M.union
            modifiedAddressIds
            ( M.fromList
                [ (addressStateRefAddress addressState, SQL.entityKey entity)
                | entity <- existingAddressEntities,
                  let addressState = SQL.entityVal entity
                ]
            )
        clearedAddressIds = mapMaybe (`M.lookup` addressIds) $ S.toList clearStorageAddresses

    unless (null clearedAddressIds) $
      SQL.deleteWhere [StorageAddressStateRefId SQL.<-. clearedAddressIds]

    let storageWrites =
          [ (addressId, storageKey, value)
          | (address, updatesForAddress) <- M.toList storageUpdates,
            Just addressId <- [M.lookup address addressIds],
            (storageKey, value) <- M.toList updatesForAddress
          ]
        insertedStorage =
          [ Storage addressId storageKey value
          | (addressId, storageKey, value) <- storageWrites,
            value /= BDefault
          ]
    forM_ (chunksOf 5000 storageWrites) $ \storageWriteChunk ->
      SQL.rawExecute
        ( "DELETE FROM storage WHERE (address_state_ref_id, key) IN ("
            <> T.intercalate "," (replicate (length storageWriteChunk) "(?, ?)")
            <> ")"
        )
        ( concatMap
            (\(addressId, storageKey, _) -> [SQL.toPersistValue addressId, SQL.toPersistValue storageKey])
            storageWriteChunk
        )
    forM_ (chunksOf 5000 insertedStorage) SQL.insertMany_
  where
    (codeUpdates, addressUpdates, clearStorageAddresses, storageUpdates) =
      foldl' foldUpdate (M.empty, M.empty, S.empty, M.empty) updates

    deletedAddresses =
      [ address
      | (address, (_, ASDeleted)) <- M.toList addressUpdates
      ]

    modifiedAddresses =
      [ (address, blockNumber, addressState)
      | (address, (blockNumber, ASModification addressState)) <- M.toList addressUpdates
      ]

    foldUpdate (codes, addresses, clears, storage) StateUpdates {..} =
      let (addresses', clears', storageAfterAddresses) =
            M.foldlWithKey'
              applyAddressUpdate
              (addresses, clears, storage)
              stateUpdatesAddresses
          storage' =
            M.foldlWithKey'
              (applyStorageUpdate addresses')
              storageAfterAddresses
              stateUpdatesStorage
       in (M.union stateUpdatesCode codes, addresses', clears', storage')
      where
        applyAddressUpdate (addresses', clears', storage') address modification =
          case modification of
            ASDeleted ->
              ( M.insert address (stateUpdatesBlockNumber, ASDeleted) addresses',
                S.insert address clears',
                M.delete address storage'
              )
            ASModification addressState ->
              ( M.insert address (stateUpdatesBlockNumber, ASModification addressState) addresses',
                clears',
                storage'
              )

        applyStorageUpdate addresses' storage' (address, storageKey) value =
          case M.lookup address addresses' of
            Just (_, ASDeleted) -> storage'
            _ -> M.insertWith M.union address (M.singleton storageKey value) storage'

    chunksOf _ [] = []
    chunksOf size values =
      let (chunk, rest) = splitAt size values
       in chunk : chunksOf size rest

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
  let blocks =
        M.fromList
          [ (blockHash block, P2P block)
          | RanBlock block _ <- idxEvents
          ]
  unless (M.null blocks) $ do
    $logDebugS "p2pIndexer" . T.pack $
      "Inserting " ++ show (M.size blocks) ++ " Redis blocks"
    A.insertMany (A.Proxy @(P2P OutputBlock)) blocks
  forM_ idxEvents $ \case
    NewBestBlock (sha, num) -> do
      $logDebugS "p2pIndexer" . T.pack $
        "Updating RedisBestBlock as (" ++ format sha ++ ", " ++ show num ++ ")"
      Mod.put (Mod.Proxy @(P2P BestBlock)) . P2P $ BestBlock sha num
    _ -> return ()
