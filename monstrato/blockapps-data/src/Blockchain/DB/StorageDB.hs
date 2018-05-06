
module Blockchain.DB.StorageDB (
  HasStorageDB(..),
  putStorageKeyVal',
  getStorageKeyVal',
  getAllStorageKeyVals',
  flushMemStorageDB
  ) where

import           Control.Monad.State
import           Control.Monad.Trans.Resource
import qualified Data.Map                                    as M
import qualified Database.LevelDB                            as DB

import           Blockchain.Data.Address
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia          as MP
import qualified Blockchain.Database.MerklePatricia.Internal as MP
import           Blockchain.DB.HashDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.StateDB
import           Blockchain.ExtWord
import qualified Data.NibbleString                           as N

class MonadResource m => HasStorageDB m where
  getStorageDB  :: m (DB.DB, M.Map (Maybe Word256, Address, Word256) Word256)
  putStorageMap :: M.Map (Maybe Word256, Address, Word256) Word256 -> m ()



putStorageKeyVal' :: (HasMemAddressStateDB m, HasStorageDB m, HasStateDB m, HasHashDB m) =>
                  Maybe Word256 -> Address -> Word256 -> Word256 -> m ()
putStorageKeyVal' = putStorageKeyValMC

getStorageKeyVal' :: (HasMemAddressStateDB m, HasStorageDB m, HasStateDB m, HasHashDB m) =>
                   Maybe Word256 -> Address -> Word256 -> m Word256
getStorageKeyVal' = getStorageKeyValMC

getAllStorageKeyVals' :: (HasMemAddressStateDB m, HasStorageDB m, HasStateDB m, HasHashDB m) =>
                       Maybe Word256 -> Address -> m [(MP.Key, Word256)]
getAllStorageKeyVals' = getAllStorageKeyValsMC

--The following are the memory cache versions of the functions

putStorageKeyValMC :: (HasMemAddressStateDB m, HasStorageDB m, HasStateDB m, HasHashDB m) =>
                  Maybe Word256 -> Address -> Word256 -> Word256 -> m ()
putStorageKeyValMC chainId owner key val = do
  theMap <- fmap snd getStorageDB
  putStorageMap $ M.insert (chainId, owner, key) val theMap

getStorageKeyValMC :: (HasMemAddressStateDB m, HasStorageDB m, HasStateDB m, HasHashDB m) =>
                   Maybe Word256 -> Address -> Word256 -> m Word256
getStorageKeyValMC chainId owner key = do
  theMap <- fmap snd getStorageDB
  case M.lookup (chainId, owner, key) theMap of
   Just val -> return val
   Nothing  -> getStorageKeyValDB chainId owner key

getAllStorageKeyValsMC :: (HasMemAddressStateDB m, HasStorageDB m, HasStateDB m, HasHashDB m) =>
                       Maybe Word256 -> Address -> m [(MP.Key, Word256)]
getAllStorageKeyValsMC = getAllStorageKeyValsDB

flushMemStorageDB :: (HasMemAddressStateDB m, HasStateDB m, HasStorageDB m, HasHashDB m) =>
                   m ()
flushMemStorageDB = do
  theMap <- fmap snd getStorageDB
  forM_ (M.toList theMap) $ \((chainId, address, key), val) ->
     putStorageKeyValDB chainId address key val
  putStorageMap M.empty








--The following are the DB versions of the functions


putStorageKeyValDB :: (HasMemAddressStateDB m, HasStorageDB m, HasStateDB m, HasHashDB m) =>
                  Maybe Word256 -> Address -> Word256 -> Word256 -> m ()
putStorageKeyValDB chainId owner key 0 = do --when val=0, we actually delete the key from the database
  addressState <- getAddressState chainId owner
  db <- fmap fst getStorageDB
  let mpdb = MP.MPDB{MP.ldb=db, MP.stateRoot=addressStateContractRoot addressState}
  newContractRoot <- fmap MP.stateRoot $ MP.deleteKey mpdb (N.pack $ (N.byte2Nibbles =<<) $ word256ToBytes key)
  putAddressState chainId owner addressState{addressStateContractRoot=newContractRoot}

putStorageKeyValDB chainId owner key val = do
  hashDBPut storageKeyNibbles
  addressState <- getAddressState chainId owner
  db <- fmap fst getStorageDB
  let mpdb = MP.MPDB{MP.ldb=db, MP.stateRoot=addressStateContractRoot addressState}
  newContractRoot <- fmap MP.stateRoot $ MP.putKeyVal mpdb storageKeyNibbles (rlpEncode $ rlpSerialize $ rlpEncode val)
  putAddressState chainId owner addressState{addressStateContractRoot=newContractRoot}
  where storageKeyNibbles = N.pack $ (N.byte2Nibbles =<<) $ word256ToBytes key

getStorageKeyValDB :: (HasMemAddressStateDB m, HasStorageDB m, HasStateDB m, HasHashDB m) =>
                   Maybe Word256 -> Address -> Word256 -> m Word256
getStorageKeyValDB chainId owner key = do
  addressState <- getAddressState chainId owner
  db <- fmap fst getStorageDB
  let mpdb = MP.MPDB{MP.ldb=db, MP.stateRoot=addressStateContractRoot addressState}
  maybeVal <- MP.getKeyVal mpdb (N.pack $ (N.byte2Nibbles =<<) $ word256ToBytes key)
  case maybeVal of
    Nothing -> return 0
    Just x  -> return $ fromInteger $ rlpDecode $ rlpDeserialize $ rlpDecode x

getAllStorageKeyValsDB :: (HasMemAddressStateDB m, HasStorageDB m, HasStateDB m, HasHashDB m) =>
                       Maybe Word256 -> Address -> m [(MP.Key, Word256)]
getAllStorageKeyValsDB chainId owner = do
  addressState <- getAddressState chainId owner
  db <- fmap fst getStorageDB
  let mpdb = MP.MPDB{MP.ldb=db, MP.stateRoot=addressStateContractRoot addressState}
  kvs <- MP.unsafeGetAllKeyVals mpdb
  return $ map (fmap $ fromInteger . rlpDecode . rlpDeserialize . rlpDecode) kvs
