{-# LANGUAGE ConstraintKinds   #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE MonoLocalBinds    #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeOperators     #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.DB.RawStorageDB
  ( RawStorageKey
  , RawStorageValue
  , HasRawStorageDB
  , HasMemRawStorageDB(..)
  , FullRawStorage
  , genericLookupRawStorageDB
  , genericInsertRawStorageDB
  , genericDeleteRawStorageDB
  , genericLookupWithFallbackRawStorageDB
  , putRawStorageKeyVal'
  , getRawStorageKeyVal'
  , getAllRawStorageKeyVals'
  , flushMemRawStorageTxDBToBlockDB
  , flushMemRawStorageDB
  ) where

import           Control.Arrow                               ((***))
import           Control.Monad.FT
import           Control.Monad.Loops
import           Control.Monad.State
import           Data.ByteString                             (ByteString)
import           Data.Default
import           Data.Foldable                               (for_)
import           Data.List                                   hiding (insert)
import           Data.Map                                    (Map)
import qualified Data.Map                                    as M
import           Data.Traversable                            (for)

import           Blockchain.Strato.Model.Account
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

instance Default ByteString where
  def = blankVal

type RawStorageKey = (Account, ByteString)
type RawStorageValue = ByteString
type HasRawStorageDB m = (RawStorageKey `Alters` RawStorageValue) m

class Monad m => HasMemRawStorageDB m where
  getMemRawStorageTxDB     :: m (M.Map RawStorageKey RawStorageValue)
  putMemRawStorageTxMap    :: M.Map RawStorageKey RawStorageValue -> m ()
  getMemRawStorageBlockDB  :: m (M.Map RawStorageKey RawStorageValue)
  putMemRawStorageBlockMap :: M.Map RawStorageKey RawStorageValue -> m ()

type FullRawStorage m = ( HasMemAddressStateDB m
                        , HasRawStorageDB m
                        , HasMemRawStorageDB m
                        , HasStateDB m
                        , HasHashDB m
                        , (Account `Alters` AddressState) m
                        )

putRawStorageKeyVal' :: HasRawStorageDB m => RawStorageKey -> RawStorageValue -> m ()
putRawStorageKeyVal' = putRawStorageKeyValMC

getRawStorageKeyVal' :: HasRawStorageDB m => RawStorageKey -> m RawStorageValue
getRawStorageKeyVal' = getRawStorageKeyValMC

getAllRawStorageKeyVals' :: FullRawStorage m => Account -> m [(MP.Key, RawStorageValue)]
getAllRawStorageKeyVals' = getAllRawStorageKeyValsMC

--The following are the memory cache versions of the functions

putRawStorageKeyValMC :: HasRawStorageDB m => RawStorageKey -> RawStorageValue -> m ()
putRawStorageKeyValMC = insert

getRawStorageKeyValMC :: HasRawStorageDB m => RawStorageKey -> m RawStorageValue
getRawStorageKeyValMC key = selectWithDefault key

genericLookupRawStorageDB :: ( HasMemRawStorageDB m
                             , (Account `Alters` AddressState) m
                             , (MP.StateRoot `Alters` MP.NodeData) m
                             )
                          => RawStorageKey
                          -> m (Maybe RawStorageValue)
genericLookupRawStorageDB key = do
  theMap <- getMemRawStorageTxDB
  case M.lookup key theMap of
   Just val -> return $ Just val
   Nothing  -> do
     theBMap <- getMemRawStorageBlockDB
     case M.lookup key theBMap of
       Just val' -> return $ Just val'
       Nothing -> do
         mVal <- getRawStorageKeyValDBMaybe key
         --put in the TX cache for fast future lookups
         for_ mVal $ \v -> putMemRawStorageTxMap $ M.insert key v theMap
         return mVal

genericLookupWithFallbackRawStorageDB
  :: ( HasMemRawStorageDB m
     , (Account `Alters` AddressState) m
     , (MP.StateRoot `Alters` MP.NodeData) m
     )
  => RawStorageValue
  -> RawStorageKey
  -> m RawStorageValue
genericLookupWithFallbackRawStorageDB fallback key = do
  theMap <- getMemRawStorageTxDB
  case M.lookup key theMap of
   Just val -> return val
   Nothing  -> do
     theBMap <- getMemRawStorageBlockDB
     case M.lookup key theBMap of
       Just val' -> return val'
       Nothing -> do
         v <- getRawStorageKeyValDB fallback key
         --put in the TX cache for fast future lookups
         putMemRawStorageTxMap $ M.insert key v theMap
         return v

genericInsertRawStorageDB :: HasMemRawStorageDB m
                          => RawStorageKey
                          -> RawStorageValue
                          -> m ()
genericInsertRawStorageDB key val = do
  theMap <- getMemRawStorageTxDB
  putMemRawStorageTxMap $ M.insert key val theMap

genericDeleteRawStorageDB :: HasMemRawStorageDB m
                          => RawStorageKey
                          -> m ()
genericDeleteRawStorageDB key = do
  theMap <- getMemRawStorageTxDB
  putMemRawStorageTxMap $ M.insert key blankVal theMap

getAllRawStorageKeyValsMC :: FullRawStorage m  => Account -> m [(MP.Key, RawStorageValue)]
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

  let changesByAddress :: Map Account [(ByteString, RawStorageValue)]
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
                                    Account -> [(ByteString, RawStorageValue)] -> m ()
putAllRawStorageKeyValForAddress owner rawChanges = do
  let changes :: [(MP.Key, MP.Val)]
      changes = map (N.EvenNibbleString *** rlpEncode) rawChanges
      blankValRLP = rlpEncode blankVal
      (allDeletes, allInserts) = partition ((== blankValRLP) . snd) changes
      deleteKeys = map fst allDeletes

  addressState <- selectWithDefault owner
  let sr = addressStateContractRoot addressState

  for_ allInserts $ hashDBPut . fst

  sr' <-
    if True                                 -- FEATUREFLAG  speed up putManyKeyVal
    then putManyKeyVal sr allInserts
    else putManyKeyValSlow sr allInserts

  sr'' <- deleteManyKeyVal sr' deleteKeys

  insert owner addressState{addressStateContractRoot=sr''}


deleteManyKeyVal :: (MP.StateRoot `Alters` MP.NodeData) m => MP.StateRoot -> [MP.Key] -> m MP.StateRoot
deleteManyKeyVal sr listOfDeletes =
  concatM (map (flip deleteRawStorageKeyValDB) listOfDeletes) sr

putManyKeyValSlow :: (MP.StateRoot `Alters` MP.NodeData) m => MP.StateRoot -> [(MP.Key, MP.Val)] -> m MP.StateRoot
putManyKeyValSlow sr listOfInserts =
  concatM (map (flip putRawStorageKeyValDB) listOfInserts) sr

putRawStorageKeyValDB :: (MP.StateRoot `Alters` MP.NodeData) m => MP.StateRoot -> (MP.Key, MP.Val) -> m MP.StateRoot
putRawStorageKeyValDB sr (key, val) = MP.putKeyVal sr key val

deleteRawStorageKeyValDB :: (MP.StateRoot `Alters` MP.NodeData) m => MP.StateRoot -> MP.Key -> m MP.StateRoot
deleteRawStorageKeyValDB sr key = MP.deleteKey sr key

getRawStorageKeyValDBMaybe :: ( (Account `Alters` AddressState) m
                              , (MP.StateRoot `Alters` MP.NodeData) m
                              )
                           => RawStorageKey -> m (Maybe RawStorageValue)
getRawStorageKeyValDBMaybe (owner, key) = do
  mContractRoot <- fmap addressStateContractRoot <$> select @AddressState owner
  fmap (fmap rlpDecode . join) . for mContractRoot $ \cr -> MP.getKeyVal cr (N.EvenNibbleString key)

getRawStorageKeyValDB :: ( (Account `Alters` AddressState) m
                         , (MP.StateRoot `Alters` MP.NodeData) m
                         )
                      => RawStorageValue -> RawStorageKey -> m RawStorageValue
getRawStorageKeyValDB fallback (owner, key) = do
  contractRoot <- addressStateContractRoot <$> selectWithDefault @AddressState owner
  maybe fallback rlpDecode <$> MP.getKeyVal contractRoot (N.EvenNibbleString key)

getAllRawStorageKeyValsDB :: FullRawStorage m => Account -> m [(MP.Key, RawStorageValue)]
getAllRawStorageKeyValsDB owner = do
  contractRoot <- addressStateContractRoot <$> selectWithDefault @AddressState owner
  kvs <- MP.unsafeGetAllKeyVals contractRoot
  return $ map (fmap rlpDecode) kvs
