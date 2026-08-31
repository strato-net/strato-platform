{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.DB.RawStorageDB
  ( RawStorageKey,
    RawStorageValue,
    HasRawStorageDB,
    HasMemRawStorageDB (..),
    --FullRawStorage,
    genericLookupRawStorageDB,
    genericInsertRawStorageDB,
    genericInsertManyRawStorageDB,
    genericDeleteRawStorageDB,
    genericLookupWithDefaultRawStorageDB,
    putRawStorageKeyVal',
    getRawStorageKeyVal',
    getRawStorageKeyValForStateRootMaybe,
    snapshotRawStorageReadCache,
    getAllRawStorageKeyVals',
    deleteRawStorageKey',
    flushMemRawStorageTxDBToBlockDB,
    flushMemRawStorageDB
  )
where

import BatchMerge
import BlockApps.Logging
import Blockchain.DB.HashDB
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.StateDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import qualified Blockchain.Database.MerklePatricia.Internal as MP
import Blockchain.Database.MerklePatricia.Profile
import Blockchain.Strato.Model.Address
import Control.Arrow ((***))
import Control.Monad (forM_, join)
import Control.Monad.IO.Class (MonadIO, liftIO)
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Loops
import Data.Default
import Data.Foldable (for_)
import qualified Data.HashMap.Strict as HM
import Data.List
import Data.Map (Map)
import qualified Data.Map as M
import Data.IORef
import qualified Data.NibbleString as N
import Data.Traversable (for)
import SolidVM.Model.Storable
import System.IO.Unsafe (unsafePerformIO)

instance Default BasicValue where
  def = blankVal

type RawStorageKey = (Address, StoragePath)

type RawStorageValue = BasicValue

{-# NOINLINE storageReadCache #-}
storageReadCache :: IORef (Int, M.Map MP.StateRoot (HM.HashMap StoragePath (Maybe RawStorageValue)))
storageReadCache = unsafePerformIO $ newIORef (0, M.empty)

cacheStorageRead :: (MP.StateRoot, StoragePath) -> Maybe RawStorageValue -> IO ()
cacheStorageRead (root, path) value = modifyIORef' storageReadCache $ \(count, cache) ->
  let (!count0, !cache0) = if count >= 500000 then (0, M.empty) else (count, cache)
      !rootCache = M.findWithDefault HM.empty root cache0
      !isNew = not $ HM.member path rootCache
      !rootCache' = HM.insert path value rootCache
   in (count0 + if isNew then 1 else 0, M.insert root rootCache' cache0)

cacheStorageReads :: MP.StateRoot -> MP.StateRoot -> [(StoragePath, RawStorageValue)] -> IO ()
cacheStorageReads parentRoot childRoot changes = modifyIORef' storageReadCache $ \(count, cache) ->
  let (!count0, !cache0) = if count >= 500000 then (0, M.empty) else (count, cache)
      -- The child trie differs from its parent only at these paths.  Reusing
      -- the parent's persistent map preserves every already-proven unchanged
      -- read instead of forcing it through the Merkle trie again under the
      -- new root.  HM.union shares the unchanged map structure.
      !parentCache = M.findWithDefault HM.empty parentRoot cache0
      !rootCache = M.findWithDefault parentCache childRoot cache0
      !newValues = HM.fromList
        [ (path, if isDefault value then Nothing else Just value)
        | (path, value) <- changes
        ]
      !newCount = HM.size $ HM.difference newValues rootCache
      !rootCache' = newValues `HM.union` rootCache
   in (count0 + newCount, M.insert childRoot rootCache' cache0)

snapshotRawStorageReadCache :: MP.StateRoot -> IO (HM.HashMap StoragePath (Maybe RawStorageValue))
snapshotRawStorageReadCache root = M.findWithDefault HM.empty root . snd <$> readIORef storageReadCache

type HasRawStorageDB m = (RawStorageKey `A.Alters` RawStorageValue) m

class Monad m => HasMemRawStorageDB m where
  getMemRawStorageTxDB :: m (M.Map RawStorageKey RawStorageValue)
  putMemRawStorageTxMap :: M.Map RawStorageKey RawStorageValue -> m ()
  getMemRawStorageBlockDB :: m (M.Map RawStorageKey RawStorageValue)
  putMemRawStorageBlockMap :: M.Map RawStorageKey RawStorageValue -> m ()

type FullRawStorage m =
  ( HasMemAddressStateDB m,
    HasRawStorageDB m,
    HasMemRawStorageDB m,
    HasStateDB m,
    HasHashDB m,
    (Address `A.Alters` AddressState) m
  )

putRawStorageKeyVal' :: HasRawStorageDB m => RawStorageKey -> RawStorageValue -> m ()
putRawStorageKeyVal' = putRawStorageKeyValMC

getRawStorageKeyVal' :: HasRawStorageDB m => RawStorageKey -> m RawStorageValue
getRawStorageKeyVal' = getRawStorageKeyValMC

getAllRawStorageKeyVals' :: FullRawStorage m => Address -> m [(MP.Key, RawStorageValue)]
getAllRawStorageKeyVals' = getAllRawStorageKeyValsMC

deleteRawStorageKey' :: HasRawStorageDB m => RawStorageKey -> m ()
deleteRawStorageKey' = deleteRawStorageKeyMC

--The following are the memory cache versions of the functions

putRawStorageKeyValMC :: HasRawStorageDB m => RawStorageKey -> RawStorageValue -> m ()
putRawStorageKeyValMC = A.insert (A.Proxy @RawStorageValue)

getRawStorageKeyValMC :: HasRawStorageDB m => RawStorageKey -> m RawStorageValue
getRawStorageKeyValMC key = A.lookupWithDefault (A.Proxy @RawStorageValue) key

deleteRawStorageKeyMC :: HasRawStorageDB m => RawStorageKey -> m ()
deleteRawStorageKeyMC = A.delete (A.Proxy @RawStorageValue)

genericLookupRawStorageDB ::
  ( MonadIO m,
    HasMemRawStorageDB m,
    (Address `A.Alters` AddressState) m,
    (MP.StateRoot `A.Alters` MP.NodeData) m
  ) =>
  RawStorageKey ->
  m (Maybe RawStorageValue)
genericLookupRawStorageDB key = do
  liftIO $ do
    noteProfileStorageKey (show key)
    bumpDBProfile StorageReadOps 1
  theMap <- getMemRawStorageTxDB
  case M.lookup key theMap of
    Just val -> do
      liftIO $ bumpDBProfile StorageTxCacheHits 1
      return $ Just val
    Nothing -> do
      liftIO $ bumpDBProfile StorageTxCacheMisses 1
      theBMap <- getMemRawStorageBlockDB
      case M.lookup key theBMap of
        Just val -> do
          liftIO $ bumpDBProfile StorageBlockCacheHits 1
          return $ Just val
        Nothing -> do
          liftIO $ bumpDBProfile StorageBlockCacheMisses 1
          mContractRoot <- fmap addressStateContractRoot <$> A.lookup (A.Proxy @AddressState) (fst key)
          mVal <- fmap join . for mContractRoot $ \root ->
            getRawStorageKeyValForStateRootMaybe root (snd key)
          for_ mVal $ \value -> putMemRawStorageTxMap $ M.insert key value theMap
          return mVal

genericLookupWithDefaultRawStorageDB ::
  ( MonadIO m,
    HasMemRawStorageDB m,
    (Address `A.Alters` AddressState) m,
    (MP.StateRoot `A.Alters` MP.NodeData) m
  ) =>
  RawStorageKey ->
  m RawStorageValue
genericLookupWithDefaultRawStorageDB key = do
  liftIO $ do
    noteProfileStorageKey (show key)
    bumpDBProfile StorageReadOps 1
  theMap <- getMemRawStorageTxDB
  case M.lookup key theMap of
    Just val -> do
      liftIO $ bumpDBProfile StorageTxCacheHits 1
      return val
    Nothing -> do
      liftIO $ bumpDBProfile StorageTxCacheMisses 1
      theBMap <- getMemRawStorageBlockDB
      case M.lookup key theBMap of
        Just val -> do
          liftIO $ bumpDBProfile StorageBlockCacheHits 1
          return val
        Nothing -> do
          liftIO $ bumpDBProfile StorageBlockCacheMisses 1
          mContractRoot <- fmap addressStateContractRoot <$> A.lookup (A.Proxy @AddressState) (fst key)
          value <- case mContractRoot of
            Nothing -> pure def
            Just root -> maybe def id <$> getRawStorageKeyValForStateRootMaybe root (snd key)
          putMemRawStorageTxMap $ M.insert key value theMap
          return value

genericInsertRawStorageDB ::
  (MonadIO m, HasMemRawStorageDB m) =>
  RawStorageKey ->
  RawStorageValue ->
  m ()
genericInsertRawStorageDB key val = do
  liftIO $ do
    noteProfileStorageKey (show key)
    bumpDBProfile StorageWriteOps 1
  theMap <- getMemRawStorageTxDB
  putMemRawStorageTxMap $ M.insert key val theMap

genericInsertManyRawStorageDB ::
  (MonadIO m, HasMemRawStorageDB m) =>
  M.Map RawStorageKey RawStorageValue ->
  m ()
genericInsertManyRawStorageDB localMap = do
  liftIO $ forM_ (M.keys localMap) $ \key -> do
    noteProfileStorageKey (show key)
    bumpDBProfile StorageWriteOps 1
  txMap <- getMemRawStorageTxDB
  putMemRawStorageTxMap $ localMap `M.union` txMap

genericDeleteRawStorageDB ::
  (MonadIO m, HasMemRawStorageDB m) =>
  RawStorageKey ->
  m ()
genericDeleteRawStorageDB key = do
  liftIO $ do
    noteProfileStorageKey (show key)
    bumpDBProfile StorageDeleteOps 1
  theMap <- getMemRawStorageTxDB
  putMemRawStorageTxMap $ M.delete key theMap

getAllRawStorageKeyValsMC :: FullRawStorage m => Address -> m [(MP.Key, RawStorageValue)]
getAllRawStorageKeyValsMC = getAllRawStorageKeyValsDB

flushMemRawStorageTxDBToBlockDB :: HasMemRawStorageDB m => m ()
flushMemRawStorageTxDBToBlockDB = do
  txMap <- getMemRawStorageTxDB
  blkMap <- getMemRawStorageBlockDB
  putMemRawStorageBlockMap $ txMap `M.union` blkMap
  putMemRawStorageTxMap M.empty

flushMemRawStorageDB :: (MonadIO m, MonadLogger m, FullRawStorage m) => m ()
flushMemRawStorageDB = do
  theMap <- getMemRawStorageBlockDB

  let changesByAddress :: Map Address [(StoragePath, RawStorageValue)]
      changesByAddress = M.fromListWith (++) $ map (\((a, k), v) -> (a, [(k, v)])) $ M.toList theMap

  forM_ (M.toList changesByAddress) $ \(a, changes) ->
    putAllRawStorageKeyValForAddress a changes

  putMemRawStorageBlockMap M.empty

--The following are the DB versions of the functions

-- TODO(tim): This is kind of ugly, because it makes the assumption that the
-- return values another layer of RLP. I think it would be cleaner to treat ""
-- as the default bytestring, but that would break stateroot compatibility for
-- the word256 based storage.
{-# NOINLINE blankVal #-}
blankVal :: RawStorageValue
blankVal = BDefault

putAllRawStorageKeyValForAddress ::
  (MonadIO m, MonadLogger m, FullRawStorage m) =>
  Address ->
  [(StoragePath, RawStorageValue)] ->
  m ()
putAllRawStorageKeyValForAddress owner rawChanges = do
  addressState <- A.lookupWithDefault A.Proxy owner
  let sr = addressStateContractRoot addressState
  sr'' <- putAllRawStorageKeyValForStateRoot sr rawChanges
  A.insert A.Proxy owner addressState {addressStateContractRoot = sr''}

putAllRawStorageKeyValForStateRoot ::
  (MonadIO m, MonadLogger m, FullRawStorage m) =>
  MP.StateRoot ->
  [(StoragePath, RawStorageValue)] ->
  m MP.StateRoot
putAllRawStorageKeyValForStateRoot sr rawChanges = do
  let changes :: [(MP.Key, MP.Val)]
      changes = map ((N.EvenNibbleString . unparsePath) *** rlpEncode) rawChanges
  sr' <- putAllKeyValForStateRoot sr changes
  -- The new trie root is the old root plus exactly these changes. Inherit all
  -- proven reads and overlay writes/deletes so unchanged cells remain cached.
  liftIO $ cacheStorageReads sr sr' rawChanges
  pure sr'

putAllKeyValForStateRoot ::
  (MonadLogger m, FullRawStorage m) =>
  MP.StateRoot ->
  [(MP.Key, MP.Val)] ->
  m MP.StateRoot
putAllKeyValForStateRoot sr changes = do
  let blankValRLP = rlpEncode blankVal
      (allDeletes, allInserts) = partition ((== blankValRLP) . snd) changes
      deleteKeys = map fst allDeletes

  safeInserts <- for allInserts $ \(rawKey, value) -> do
    safeKey <- hashDBPutAndGetSafeKey rawKey
    pure (safeKey, value)

  sr' <-
    if True -- FEATUREFLAG  speed up putManyKeyVal
      then putManySafeKeyVal sr safeInserts
      else putManyKeyValSlow sr allInserts

  sr'' <- deleteManyKeyVal sr' deleteKeys

  pure sr''

deleteManyKeyVal :: (MP.StateRoot `A.Alters` MP.NodeData) m => MP.StateRoot -> [MP.Key] -> m MP.StateRoot
deleteManyKeyVal sr listOfDeletes =
  concatM (map (flip deleteRawStorageKeyValDB) listOfDeletes) sr

putManyKeyValSlow :: (MP.StateRoot `A.Alters` MP.NodeData) m => MP.StateRoot -> [(MP.Key, MP.Val)] -> m MP.StateRoot
putManyKeyValSlow sr listOfInserts =
  concatM (map (flip putRawStorageKeyValDB) listOfInserts) sr

putRawStorageKeyValDB :: (MP.StateRoot `A.Alters` MP.NodeData) m => MP.StateRoot -> (MP.Key, MP.Val) -> m MP.StateRoot
putRawStorageKeyValDB sr (key, val) = MP.putKeyVal sr key val

deleteRawStorageKeyValDB :: (MP.StateRoot `A.Alters` MP.NodeData) m => MP.StateRoot -> MP.Key -> m MP.StateRoot
deleteRawStorageKeyValDB sr key = MP.deleteKey sr key

-- | Read a SolidVM storage cell once its owning account's contract root is
-- already known.  Fast execution frames use this after snapshotting their
-- overlays, avoiding an identical account-state lookup for every distinct
-- cell read from the same contract.
getRawStorageKeyValForStateRootMaybe ::
  (MonadIO m, (MP.StateRoot `A.Alters` MP.NodeData) m) =>
  MP.StateRoot ->
  StoragePath ->
  m (Maybe RawStorageValue)
getRawStorageKeyValForStateRootMaybe cr key = do
  cache <- liftIO $ snapshotRawStorageReadCache cr
  case HM.lookup key cache of
    Just result -> do
      liftIO $ bumpDBProfile StorageReadCacheHits 1
      pure result
    Nothing -> do
      liftIO $ bumpDBProfile StorageReadCacheMisses 1
      result <- fmap rlpDecode <$> MP.getKeyVal cr (N.EvenNibbleString $ unparsePath key)
      liftIO $ cacheStorageRead (cr, key) result
      pure result

getAllRawStorageKeyValsDB :: FullRawStorage m => Address -> m [(MP.Key, RawStorageValue)]
getAllRawStorageKeyValsDB owner = do
  contractRoot <- addressStateContractRoot <$> A.lookupWithDefault (A.Proxy @AddressState) owner
  kvs <- MP.unsafeGetAllKeyVals contractRoot
  return $ map (fmap rlpDecode) kvs
