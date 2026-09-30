{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TupleSections #-}
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
    getAllRawStorageKeyVals',
    deleteRawStorageKey',
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
import Blockchain.Strato.Model.Address
import Control.Arrow ((***))
import Control.Monad (forM_, join, unless)
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Loops
import Data.Default
import Data.Foldable (for_)
import qualified Data.HashSet as HS
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
  getMemRawStorageBlockDB :: m (BlockMap RawStorageKey RawStorageValue)
  putMemRawStorageBlockMap :: BlockMap RawStorageKey RawStorageValue -> m ()

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
  theBMap <- getMemRawStorageBlockDB
  case lookupBlockMap key theBMap of
    Just known -> return known
    Nothing -> do
      mVal <- getRawStorageKeyValDBMaybe key
      putMemRawStorageBlockMap $ insertReadBlockMap key mVal theBMap
      return mVal

genericLookupWithDefaultRawStorageDB ::
  ( HasMemRawStorageDB m,
    (Address `A.Alters` AddressState) m,
    (MP.StateRoot `A.Alters` MP.NodeData) m
  ) =>
  RawStorageKey ->
  m RawStorageValue
genericLookupWithDefaultRawStorageDB key = maybe def id <$> genericLookupRawStorageDB key

genericInsertRawStorageDB ::
  HasMemRawStorageDB m =>
  RawStorageKey ->
  RawStorageValue ->
  m ()
genericInsertRawStorageDB key val =
  putMemRawStorageBlockMap . insertBlockMap key val =<< getMemRawStorageBlockDB

genericInsertManyRawStorageDB ::
  HasMemRawStorageDB m =>
  M.Map RawStorageKey RawStorageValue ->
  m ()
genericInsertManyRawStorageDB localMap =
  putMemRawStorageBlockMap . insertManyBlockMap localMap =<< getMemRawStorageBlockDB

genericDeleteRawStorageDB ::
  HasMemRawStorageDB m =>
  RawStorageKey ->
  m ()
genericDeleteRawStorageDB key =
  putMemRawStorageBlockMap . deleteBlockMap key =<< getMemRawStorageBlockDB

getAllRawStorageKeyValsMC :: FullRawStorage m => Address -> m [(MP.Key, RawStorageValue)]
getAllRawStorageKeyValsMC = getAllRawStorageKeyValsDB

flushMemRawStorageDB :: (MonadLogger m, FullRawStorage m) => m ()
flushMemRawStorageDB = do
  bm <- getMemRawStorageBlockDB

  let changesByAddress :: Map Address [(StoragePath, RawStorageValue)]
      changesByAddress = M.fromListWith (++) [(a, [(k, v)]) | ((a, k), v) <- dirtyBlockMap bm]

  forM_ (M.toList changesByAddress) $ \(a, changes) ->
    putAllRawStorageKeyValForAddress a changes

  -- Flushed entries stay in the block map as reads; see flushMemAddressStateDB.
  putMemRawStorageBlockMap $ bm {bmDirty = HS.empty}

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

putAllKeyValForStateRoot ::
  (MonadLogger m, FullRawStorage m) =>
  MP.StateRoot ->
  [(MP.Key, MP.Val)] ->
  m MP.StateRoot
putAllKeyValForStateRoot sr changes = do
  let blankValRLP = rlpEncode blankVal
      (allDeletes, allInserts) = partition ((== blankValRLP) . snd) changes
      deleteKeys = map fst allDeletes

  (sr', existed) <- putManyKeyValExisted sr allInserts
  -- the hash->key entry is immutable; only newly created keys need one
  for_ allInserts $ \(k, _) -> unless (k `elem` existed) $ hashDBPut k

  sr'' <- deleteManyKeyVal sr' deleteKeys

  pure sr''

deleteManyKeyVal :: (MP.StateRoot `A.Alters` MP.NodeData) m => MP.StateRoot -> [MP.Key] -> m MP.StateRoot
deleteManyKeyVal sr listOfDeletes =
  concatM (map (flip deleteRawStorageKeyValDB) listOfDeletes) sr

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

getAllRawStorageKeyValsDB :: FullRawStorage m => Address -> m [(MP.Key, RawStorageValue)]
getAllRawStorageKeyValsDB owner = do
  contractRoot <- addressStateContractRoot <$> A.lookupWithDefault (A.Proxy @AddressState) owner
  kvs <- MP.unsafeGetAllKeyVals contractRoot
  return $ map (fmap rlpDecode) kvs
