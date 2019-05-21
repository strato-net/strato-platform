{-# LANGUAGE ConstraintKinds   #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators     #-}

module Blockchain.DB.RawStorageDB (
  HasRawStorageDB(..),
  putRawStorageKeyVal',
  getRawStorageKeyVal',
  getAllRawStorageKeyVals',
  flushRawStorageTxDBToBlockDB,
  flushMemRawStorageDB
 ) where

import qualified Control.Monad.Change.Alter                  as A
import           Control.Monad.Loops
import           Control.Monad.State
import           Data.ByteString                             (ByteString)
import qualified Data.ByteString                             as B
import           Data.Foldable                               (for_)
import           Data.List
import           Data.Map                                    (Map)
import qualified Data.Map                                    as M
import qualified Database.LevelDB                            as DB

import           Blockchain.Strato.Model.Address
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia          as MP
import qualified Blockchain.Database.MerklePatricia.Internal as MP
import           Blockchain.DB.HashDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.StateDB
import qualified Data.NibbleString                           as N

import BatchMerge

class MonadIO m => HasRawStorageDB m where
  getRawStorageTxDB     :: m (DB.DB, M.Map (Address, B.ByteString) B.ByteString)
  putRawStorageTxMap    :: M.Map (Address, B.ByteString) B.ByteString -> m ()
  getRawStorageBlockDB  :: m (DB.DB, M.Map (Address, B.ByteString) B.ByteString)
  putRawStorageBlockMap :: M.Map (Address, B.ByteString) B.ByteString -> m ()

type FullRawStorage m = ( HasMemAddressStateDB m
                        , HasRawStorageDB m
                        , HasStateDB m
                        , HasHashDB m
                        , (Address `A.Alters` AddressState) m
                        , (MP.StateRoot `A.Alters` MP.NodeData) m
                        )

putRawStorageKeyVal' :: FullRawStorage m => Address -> B.ByteString -> B.ByteString -> m ()
putRawStorageKeyVal' = putRawStorageKeyValMC

getRawStorageKeyVal' :: FullRawStorage m => Address -> B.ByteString -> m B.ByteString
getRawStorageKeyVal' = getRawStorageKeyValMC

getAllRawStorageKeyVals' :: FullRawStorage m => Address -> m [(MP.Key, B.ByteString)]
getAllRawStorageKeyVals' = getAllRawStorageKeyValsMC

--The following are the memory cache versions of the functions

putRawStorageKeyValMC :: FullRawStorage m => Address -> B.ByteString -> B.ByteString -> m ()
putRawStorageKeyValMC owner key val = do
  theMap <- fmap snd getRawStorageTxDB
  putRawStorageTxMap $ M.insert (owner, key) val theMap

getRawStorageKeyValMC :: FullRawStorage m => Address -> B.ByteString -> m B.ByteString
getRawStorageKeyValMC owner key = do
  theMap <- fmap snd getRawStorageTxDB
  case M.lookup (owner, key) theMap of
   Just val -> return val
   Nothing  -> do
     theBMap <- fmap snd getRawStorageBlockDB
     case M.lookup (owner, key) theBMap of
       Just val' -> return val'
       Nothing -> do
         valFromDB <- getRawStorageKeyValDB owner key
         putRawStorageKeyValMC owner key valFromDB --put in the TX cache for fast future lookups
         return valFromDB

getAllRawStorageKeyValsMC :: FullRawStorage m  => Address -> m [(MP.Key, B.ByteString)]
getAllRawStorageKeyValsMC = getAllRawStorageKeyValsDB

flushRawStorageTxDBToBlockDB :: FullRawStorage m => m ()
flushRawStorageTxDBToBlockDB = do
  txMap <- snd <$> getRawStorageTxDB
  blkMap <- snd <$> getRawStorageBlockDB
  putRawStorageBlockMap $ txMap `M.union` blkMap
  putRawStorageTxMap M.empty

flushMemRawStorageDB :: FullRawStorage m => m ()
flushMemRawStorageDB = do
  flushRawStorageTxDBToBlockDB
  theMap <- fmap snd getRawStorageBlockDB

  let changesByAddress :: Map Address [(ByteString, ByteString)]
      changesByAddress = M.fromListWith (++)  $ map (\((a, k), v) -> (a, [(k, v)])) $ M.toList theMap

  forM_ (M.toList changesByAddress) $ \(a, changes) ->
    putAllRawStorageKeyValForAddress a changes

  putRawStorageBlockMap M.empty





--The following are the DB versions of the functions

-- TODO(tim): This is kind of ugly, because it makes the assumption that the
-- return values another layer of RLP. I think it would be cleaner to treat ""
-- as the default bytestring, but that would break stateroot compatibility for
-- the word256 based storage.
{-# NOINLINE blankVal #-}
blankVal :: B.ByteString
blankVal = rlpSerialize $ RLPString ""


putAllRawStorageKeyValForAddress :: FullRawStorage m =>
                                    Address -> [(B.ByteString, B.ByteString)] -> m ()
putAllRawStorageKeyValForAddress owner rawChanges = do
  let changes :: [(MP.Key, MP.Val)]
      changes = map (\(k, v) -> (N.EvenNibbleString k, rlpEncode v)) rawChanges
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

getRawStorageKeyValDB :: FullRawStorage m => Address -> B.ByteString -> m B.ByteString
getRawStorageKeyValDB owner key = do
  contractRoot <- addressStateContractRoot <$> A.lookupWithDefault A.Proxy owner
  maybe blankVal rlpDecode <$> MP.getKeyVal contractRoot (N.EvenNibbleString key)

getAllRawStorageKeyValsDB :: FullRawStorage m => Address -> m [(MP.Key, B.ByteString)]
getAllRawStorageKeyValsDB owner = do
  contractRoot <- addressStateContractRoot <$> A.lookupWithDefault A.Proxy owner
  kvs <- MP.unsafeGetAllKeyVals contractRoot
  return $ map (fmap rlpDecode) kvs
