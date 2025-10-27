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
    FullRawStorage,
    genericLookupRawStorageDB,
    genericInsertRawStorageDB,
    genericInsertManyRawStorageDB,
    genericDeleteRawStorageDB,
    genericLookupWithDefaultRawStorageDB,
    putRawStorageKeyVal',
    getRawStorageKeyVal',
    getAllRawStorageKeyVals',
    deleteRawStorageKey',
    flushMemRawStorageTxDBToBlockDB,
    flushMemRawStorageDB,
    flushMemDBs
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
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ExtendedWord
import Control.Arrow ((***))
import Control.Monad (forM_, join)
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Loops
import Data.Default
import Data.Foldable (for_)
import Data.List
import Data.Map (Map)
import qualified Data.Map as M
import qualified Data.NibbleString as N
import Data.Traversable (for)
import SolidVM.Model.Storable

instance Default BasicValue where
  def = blankVal

type RawStorageKey = (Address, StoragePath)

type RawStorageValue = BasicValue

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
  ( HasMemRawStorageDB m,
    (Address `A.Alters` AddressState) m,
    (MP.StateRoot `A.Alters` MP.NodeData) m
  ) =>
  RawStorageKey ->
  m (Maybe RawStorageValue)
genericLookupRawStorageDB key = do
  theMap <- getMemRawStorageTxDB
  case M.lookup key theMap of
    Just val -> return $ Just val
    Nothing -> do
      theBMap <- getMemRawStorageBlockDB
      case M.lookup key theBMap of
        Just val' -> return $ Just val'
        Nothing -> do
          mVal <- getRawStorageKeyValDBMaybe key
          --put in the TX cache for fast future lookups
          for_ mVal $ \v -> putMemRawStorageTxMap $ M.insert key v theMap
          return mVal

genericLookupWithDefaultRawStorageDB ::
  ( HasMemRawStorageDB m,
    (Address `A.Alters` AddressState) m,
    (MP.StateRoot `A.Alters` MP.NodeData) m
  ) =>
  RawStorageKey ->
  m RawStorageValue
genericLookupWithDefaultRawStorageDB key = do
  theMap <- getMemRawStorageTxDB
  case M.lookup key theMap of
    Just val -> return val
    Nothing -> do
      theBMap <- getMemRawStorageBlockDB
      case M.lookup key theBMap of
        Just val' -> return val'
        Nothing -> do
          v <- getRawStorageKeyValDB key
          --put in the TX cache for fast future lookups
          putMemRawStorageTxMap $ M.insert key v theMap
          return v

genericInsertRawStorageDB ::
  HasMemRawStorageDB m =>
  RawStorageKey ->
  RawStorageValue ->
  m ()
genericInsertRawStorageDB key val = do
  theMap <- getMemRawStorageTxDB
  putMemRawStorageTxMap $ M.insert key val theMap

genericInsertManyRawStorageDB ::
  HasMemRawStorageDB m =>
  M.Map RawStorageKey RawStorageValue ->
  m ()
genericInsertManyRawStorageDB localMap = do
  txMap <- getMemRawStorageTxDB
  putMemRawStorageTxMap $ localMap `M.union` txMap

genericDeleteRawStorageDB ::
  HasMemRawStorageDB m =>
  RawStorageKey ->
  m ()
genericDeleteRawStorageDB key = do
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

flushMemRawStorageDB :: (MonadLogger m, FullRawStorage m) => m ()
flushMemRawStorageDB = do
  flushMemRawStorageTxDBToBlockDB
  theMap <- getMemRawStorageBlockDB

  let changesByAddress :: Map Address [(StoragePath, RawStorageValue)]
      changesByAddress = M.fromListWith (++) $ map (\((a, k), v) -> (a, [(k, v)])) $ M.toList theMap

  forM_ (M.toList changesByAddress) $ \(a, changes) ->
    putAllRawStorageKeyValForAddress a changes

  putMemRawStorageBlockMap M.empty

flushMemDBs :: (MonadLogger m, FullRawStorage m) => m ()
flushMemDBs = do
  flushMemRawStorageTxDBToBlockDB
  storageMap <- getMemRawStorageBlockDB

  let changesByAddress :: Map Address [(StoragePath, RawStorageValue)]
      changesByAddress = M.fromListWith (++) $ map (\((a, k), v) -> (a, [(k, v)])) $ M.toList storageMap

  forM_ (M.toList changesByAddress) $ \(a, changes) -> do
    addressState <- A.lookupWithDefault A.Proxy a
    cr' <- putAllRawStorageKeyValForStateRoot (addressStateContractRoot addressState) changes
    A.insert A.Proxy a addressState {addressStateContractRoot = cr'}

  flushMemAddressStateTxToBlockDB
  addrStMap <- getAddressStateBlockDBMap
  sr <- A.lookupWithDefault (A.Proxy @MP.StateRoot) (Nothing :: Maybe Word256)
  sr' <- putAllAddressStateKeyValForStateRoot sr $ M.toList addrStMap
  A.insert (A.Proxy @MP.StateRoot) (Nothing :: Maybe Word256) sr'

  putMemRawStorageBlockMap M.empty
  putAddressStateBlockDBMap M.empty

--The following are the DB versions of the functions

-- TODO(tim): This is kind of ugly, because it makes the assumption that the
-- return values another layer of RLP. I think it would be cleaner to treat ""
-- as the default bytestring, but that would break stateroot compatibility for
-- the word256 based storage.
{-# NOINLINE blankVal #-}
blankVal :: RawStorageValue
blankVal = BDefault

putAllRawStorageKeyValForAddress ::
  (MonadLogger m, FullRawStorage m) =>
  Address ->
  [(StoragePath, RawStorageValue)] ->
  m ()
putAllRawStorageKeyValForAddress owner rawChanges = do
  addressState <- A.lookupWithDefault A.Proxy owner
  let sr = addressStateContractRoot addressState
  sr'' <- putAllRawStorageKeyValForStateRoot sr rawChanges
  A.insert A.Proxy owner addressState {addressStateContractRoot = sr''}

putAllRawStorageKeyValForStateRoot ::
  (MonadLogger m, FullRawStorage m) =>
  MP.StateRoot ->
  [(StoragePath, RawStorageValue)] ->
  m MP.StateRoot
putAllRawStorageKeyValForStateRoot sr rawChanges = do
  let changes :: [(MP.Key, MP.Val)]
      changes = map ((N.EvenNibbleString . unparsePath) *** rlpEncode) rawChanges
  putAllKeyValForStateRoot sr changes

putAllAddressStateKeyValForStateRoot ::
  (MonadLogger m, FullRawStorage m) =>
  MP.StateRoot ->
  [(Address, AddressStateModification)] ->
  m MP.StateRoot
putAllAddressStateKeyValForStateRoot sr rawChanges = do
  let changes :: [(MP.Key, MP.Val)]
      changes = map (addressAsNibbleString *** encodeASM) rawChanges
      encodeASM (ASModification as) = rlpEncode as
      encodeASM ASDeleted = rlpEncode blankVal
  putAllKeyValForStateRoot sr changes

putAllKeyValForStateRoot ::
  (MonadLogger m, FullRawStorage m) =>
  MP.StateRoot ->
  [(MP.Key, MP.Val)] ->
  m MP.StateRoot
putAllKeyValForStateRoot sr changes = do
  let blankValRLP = rlpEncode blankVal
      (allDeletes, allInserts) = partition ((== blankValRLP) . snd) changes
      deleteKeys = map fst allDeletes

  for_ allInserts $ hashDBPut . fst

  sr' <-
    if True -- FEATUREFLAG  speed up putManyKeyVal
      then putManyKeyVal sr allInserts
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

getRawStorageKeyValDBMaybe ::
  ( (Address `A.Alters` AddressState) m,
    (MP.StateRoot `A.Alters` MP.NodeData) m
  ) =>
  RawStorageKey ->
  m (Maybe RawStorageValue)
getRawStorageKeyValDBMaybe (owner, key) = do
  mContractRoot <- fmap addressStateContractRoot <$> A.lookup (A.Proxy @AddressState) owner
  fmap (fmap rlpDecode . join) . for mContractRoot $ \cr -> MP.getKeyVal cr (N.EvenNibbleString $ unparsePath key)

getRawStorageKeyValDB ::
  ( (Address `A.Alters` AddressState) m,
    (MP.StateRoot `A.Alters` MP.NodeData) m
  ) =>
  RawStorageKey ->
  m RawStorageValue
getRawStorageKeyValDB (owner, key) = do
  contractRoot <- addressStateContractRoot <$> A.lookupWithDefault (A.Proxy @AddressState) owner
  maybe def rlpDecode <$> MP.getKeyVal contractRoot (N.EvenNibbleString $ unparsePath key)

getAllRawStorageKeyValsDB :: FullRawStorage m => Address -> m [(MP.Key, RawStorageValue)]
getAllRawStorageKeyValsDB owner = do
  contractRoot <- addressStateContractRoot <$> A.lookupWithDefault (A.Proxy @AddressState) owner
  kvs <- MP.unsafeGetAllKeyVals contractRoot
  return $ map (fmap rlpDecode) kvs
