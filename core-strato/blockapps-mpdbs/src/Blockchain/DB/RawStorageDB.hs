{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE OverloadedStrings #-}
module Blockchain.DB.RawStorageDB (
  HasRawStorageDB(..),
  putRawStorageKeyVal',
  getRawStorageKeyVal',
  getAllRawStorageKeyVals',
  flushRawStorageTxDBToBlockDB,
  flushMemRawStorageDB
 ) where

import           Control.Monad.State
import qualified Data.ByteString                             as B
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

class MonadIO m => HasRawStorageDB m where
  getRawStorageTxDB     :: m (DB.DB, M.Map (Address, B.ByteString) B.ByteString)
  putRawStorageTxMap    :: M.Map (Address, B.ByteString) B.ByteString -> m ()
  getRawStorageBlockDB  :: m (DB.DB, M.Map (Address, B.ByteString) B.ByteString)
  putRawStorageBlockMap :: M.Map (Address, B.ByteString) B.ByteString -> m ()

type FullRawStorage m = (HasMemAddressStateDB m, HasRawStorageDB m, HasStateDB m, HasHashDB m)

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
       Nothing -> getRawStorageKeyValDB owner key

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
  forM_ (M.toList theMap) $ \((address, key), val) ->
     putRawStorageKeyValDB address key val
  putRawStorageBlockMap M.empty


--The following are the DB versions of the functions

-- TODO(tim): This is kind of ugly, because it makes the assumption that the
-- return values another layer of RLP. I think it would be cleaner to treat ""
-- as the default bytestring, but that would break stateroot compatibility for
-- the word256 based storage.
{-# NOINLINE blankVal #-}
blankVal :: B.ByteString
blankVal = rlpSerialize $ RLPString ""

putRawStorageKeyValDB :: FullRawStorage m => Address -> B.ByteString -> B.ByteString -> m ()
putRawStorageKeyValDB owner key val =
  if val == blankVal
    then do --when val=0, we actually delete the key from the database
      addressState <- getAddressState owner
      db <- fmap fst getRawStorageBlockDB
      let mpdb = MP.MPDB{MP.ldb=db, MP.stateRoot=addressStateContractRoot addressState}
      newContractRoot <- fmap MP.stateRoot
                       $ MP.deleteKey mpdb (N.EvenNibbleString key)
      putAddressState owner addressState{addressStateContractRoot=newContractRoot}
    else do
      hashDBPut storageKeyNibbles
      addressState <- getAddressState owner
      db <- fmap fst getRawStorageBlockDB
      let mpdb = MP.MPDB{MP.ldb=db, MP.stateRoot=addressStateContractRoot addressState}
      newContractRoot <- fmap MP.stateRoot
                       $ MP.putKeyVal mpdb storageKeyNibbles (rlpEncode val)
      putAddressState owner addressState{addressStateContractRoot=newContractRoot}
 where storageKeyNibbles = N.EvenNibbleString key

getRawStorageKeyValDB :: FullRawStorage m => Address -> B.ByteString -> m B.ByteString
getRawStorageKeyValDB owner key = do
  addressState <- getAddressState owner
  db <- fmap fst getRawStorageBlockDB
  let mpdb = MP.MPDB{MP.ldb=db, MP.stateRoot=addressStateContractRoot addressState}
  maybe blankVal rlpDecode <$> MP.getKeyVal mpdb (N.EvenNibbleString key)

getAllRawStorageKeyValsDB :: FullRawStorage m => Address -> m [(MP.Key, B.ByteString)]
getAllRawStorageKeyValsDB owner = do
  addressState <- getAddressState owner
  db <- fmap fst getRawStorageBlockDB
  let mpdb = MP.MPDB{MP.ldb=db, MP.stateRoot=addressStateContractRoot addressState}
  kvs <- MP.unsafeGetAllKeyVals mpdb
  return $ map (fmap rlpDecode) kvs
