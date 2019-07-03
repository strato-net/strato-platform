{-# LANGUAGE ConstraintKinds   #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE MonoLocalBinds    #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeOperators     #-}

module Blockchain.DB.RawStorageDB
  ( RawStorageKey
  , RawStorageValue
  , HasRawStorageDB
  , HasMemRawStorageDB(..)
  , FullRawStorage
  , genericLookupRawStorageDB
  , genericInsertRawStorageDB
  , genericDeleteRawStorageDB
  , putRawStorageKeyVal'
  , getRawStorageKeyVal'
  , getAllRawStorageKeyVals'
  , flushMemRawStorageTxDBToBlockDB
  , flushMemRawStorageDB
  ) where

import           Control.Arrow                               ((***))
import qualified Control.Monad.Change.Alter                  as A
import           Control.Monad.Loops
import           Control.Monad.State
import           Data.ByteString                             (ByteString)
import           Data.Foldable                               (for_)
import           Data.List
import           Data.Map                                    (Map)
import qualified Data.Map                                    as M
import           Data.Maybe                                  (fromMaybe)
import           Data.Traversable                            (for)
import qualified Database.LevelDB                            as DB

import           Blockchain.Strato.Model.Address
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia          as MP
import qualified Blockchain.Database.MerklePatricia.Internal as MP
import           Blockchain.DB.HashDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.StateDB
import           Blockchain.Output
import qualified Data.NibbleString                           as N

import BatchMerge

type RawStorageKey = (Address, ByteString)
type RawStorageValue = ByteString
type HasRawStorageDB m = (RawStorageKey `A.Alters` RawStorageValue) m

class Monad m => HasMemRawStorageDB m where
  getMemRawStorageTxDB     :: m (DB.DB, M.Map RawStorageKey RawStorageValue)
  putMemRawStorageTxMap    :: M.Map RawStorageKey RawStorageValue -> m ()
  getMemRawStorageBlockDB  :: m (DB.DB, M.Map RawStorageKey RawStorageValue)
  putMemRawStorageBlockMap :: M.Map RawStorageKey RawStorageValue -> m ()

type FullRawStorage m = ( HasMemAddressStateDB m
                        , HasRawStorageDB m
                        , HasMemRawStorageDB m
                        , HasStateDB m
                        , HasHashDB m
                        , (Address `A.Alters` AddressState) m
                        )

putRawStorageKeyVal' :: HasRawStorageDB m => RawStorageKey -> RawStorageValue -> m ()
putRawStorageKeyVal' = putRawStorageKeyValMC

getRawStorageKeyVal' :: HasRawStorageDB m => RawStorageKey -> m RawStorageValue
getRawStorageKeyVal' = getRawStorageKeyValMC

getAllRawStorageKeyVals' :: FullRawStorage m => Address -> m [(MP.Key, RawStorageValue)]
getAllRawStorageKeyVals' = getAllRawStorageKeyValsMC

--The following are the memory cache versions of the functions

putRawStorageKeyValMC :: HasRawStorageDB m => RawStorageKey -> RawStorageValue -> m ()
putRawStorageKeyValMC = A.insert (A.Proxy @RawStorageValue)

-- TODO: can't use lookupWithDefault or lookupWithMempty because RawStorageValues are already
-- RLP serialized, and an empty bytestring is invalid RLP (rlpSplit bottoms out when given one).
-- We'll need a newtype to make this distinction, but for now, just use fromMaybe
getRawStorageKeyValMC :: HasRawStorageDB m => RawStorageKey -> m RawStorageValue
getRawStorageKeyValMC key = fromMaybe blankVal <$> A.lookup (A.Proxy @RawStorageValue) key

genericLookupRawStorageDB :: ( HasMemRawStorageDB m
                             , (Address `A.Alters` AddressState) m
                             , (MP.StateRoot `A.Alters` MP.NodeData) m
                             )
                          => RawStorageKey
                          -> m (Maybe RawStorageValue)
genericLookupRawStorageDB key = do
  theMap <- snd <$> getMemRawStorageTxDB
  case M.lookup key theMap of
   Just val -> return $ Just val
   Nothing  -> do
     theBMap <- snd <$> getMemRawStorageBlockDB
     case M.lookup key theBMap of
       Just val' -> return $ Just val'
       Nothing -> do
         mVal <- getRawStorageKeyValDB key
         --put in the TX cache for fast future lookups
         for_ mVal $ \v -> putMemRawStorageTxMap $ M.insert key v theMap
         return mVal

genericInsertRawStorageDB :: HasMemRawStorageDB m
                          => RawStorageKey
                          -> RawStorageValue
                          -> m ()
genericInsertRawStorageDB key val = do
  theMap <- snd <$> getMemRawStorageTxDB
  putMemRawStorageTxMap $ M.insert key val theMap

genericDeleteRawStorageDB :: HasMemRawStorageDB m
                          => RawStorageKey
                          -> m ()
genericDeleteRawStorageDB key = do
  theMap <- snd <$> getMemRawStorageTxDB
  putMemRawStorageTxMap $ M.insert key blankVal theMap

getAllRawStorageKeyValsMC :: FullRawStorage m  => Address -> m [(MP.Key, RawStorageValue)]
getAllRawStorageKeyValsMC = getAllRawStorageKeyValsDB

flushMemRawStorageTxDBToBlockDB :: HasMemRawStorageDB m => m ()
flushMemRawStorageTxDBToBlockDB = do
  txMap <- snd <$> getMemRawStorageTxDB
  blkMap <- snd <$> getMemRawStorageBlockDB
  putMemRawStorageBlockMap $ txMap `M.union` blkMap
  putMemRawStorageTxMap M.empty

flushMemRawStorageDB :: (MonadLogger m, FullRawStorage m) => m ()
flushMemRawStorageDB = do
  flushMemRawStorageTxDBToBlockDB
  theMap <- fmap snd getMemRawStorageBlockDB

  let changesByAddress :: Map Address [(ByteString, RawStorageValue)]
      changesByAddress = M.fromListWith (++)  $ map (\((a, k), v) -> (a, [(k, v)])) $ M.toList theMap

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
blankVal = rlpSerialize $ RLPString ""


putAllRawStorageKeyValForAddress :: (MonadLogger m, FullRawStorage m) =>
                                    Address -> [(ByteString, RawStorageValue)] -> m ()
putAllRawStorageKeyValForAddress owner rawChanges = do
  let changes :: [(MP.Key, MP.Val)]
      changes = map (N.EvenNibbleString *** rlpEncode) rawChanges
      blankValRLP = rlpEncode blankVal
      (allDeletes, allInserts) = partition ((== blankValRLP) . snd) changes
      deleteKeys = map fst allDeletes

  addressState <- A.lookupWithDefault A.Proxy owner
  let sr = addressStateContractRoot addressState

  for_ allInserts $ hashDBPut . fst

  sr' <-
    if True                                 -- FEATUREFLAG  speed up putManyKeyVal
    then putManyKeyVal sr allInserts
    else putManyKeyValSlow sr allInserts

  sr'' <- deleteManyKeyVal sr' deleteKeys

  A.insert A.Proxy owner addressState{addressStateContractRoot=sr''}


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

getRawStorageKeyValDB :: ( (Address `A.Alters` AddressState) m
                         , (MP.StateRoot `A.Alters` MP.NodeData) m
                         )
                      => RawStorageKey -> m (Maybe RawStorageValue)
getRawStorageKeyValDB (owner, key) = do
  mContractRoot <- fmap addressStateContractRoot <$> A.lookup (A.Proxy @AddressState) owner
  fmap (fmap rlpDecode . join) . for mContractRoot $ \cr -> MP.getKeyVal cr (N.EvenNibbleString key)

getAllRawStorageKeyValsDB :: FullRawStorage m => Address -> m [(MP.Key, RawStorageValue)]
getAllRawStorageKeyValsDB owner = do
  contractRoot <- addressStateContractRoot <$> A.lookupWithDefault (A.Proxy @AddressState) owner
  kvs <- MP.unsafeGetAllKeyVals contractRoot
  return $ map (fmap rlpDecode) kvs
