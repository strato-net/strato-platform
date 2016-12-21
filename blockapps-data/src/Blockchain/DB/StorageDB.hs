
module Blockchain.DB.StorageDB (
  HasStorageDB(..),
  putStorageKeyVal',
  getStorageKeyVal',
  getAllStorageKeyVals',
  flushMemStorageDB
  ) where

import Control.Monad.State
import Control.Monad.Trans.Resource
import qualified Data.Map as M
import qualified Database.LevelDB as DB

import qualified Data.NibbleString as N
import Blockchain.Data.Address
import Blockchain.Data.AddressStateDB
import Blockchain.Data.RLP
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.HashDB
import Blockchain.DB.StateDB
import qualified Blockchain.Database.MerklePatricia as MP
import qualified Blockchain.Database.MerklePatricia.Internal as MP
import Blockchain.ExtWord
  
class MonadResource m=>
      HasStorageDB m where
  getStorageDB::Monad m=>m (DB.DB, M.Map (Address, Word256) Word256)
  putStorageMap::Monad m=>M.Map (Address, Word256) Word256->m ()



putStorageKeyVal'::(HasMemAddressStateDB m, HasStorageDB m, HasStateDB m, HasHashDB m)=>
                  Address->Word256->Word256->m ()
putStorageKeyVal' owner key val = putStorageKeyValMC owner key val

getStorageKeyVal'::(HasMemAddressStateDB m, HasStorageDB m, HasStateDB m, HasHashDB m)=>
                   Address->Word256->m Word256
getStorageKeyVal' owner key = getStorageKeyValMC owner key

getAllStorageKeyVals'::(HasMemAddressStateDB m, HasStorageDB m, HasStateDB m, HasHashDB m)=>
                       Address->m [(MP.Key, Word256)]
getAllStorageKeyVals' owner = getAllStorageKeyValsMC owner



{-
putStorageKeyVal'::(HasMemAddressStateDB m, HasStorageDB m, HasStateDB m, HasHashDB m)=>
                  Address->Word256->Word256->m ()
putStorageKeyVal' owner key val = putStorageKeyValDB owner key val

getStorageKeyVal'::(HasMemAddressStateDB m, HasStorageDB m, HasStateDB m, HasHashDB m)=>
                   Address->Word256->m Word256
getStorageKeyVal' owner key = getStorageKeyValDB owner key

getAllStorageKeyVals'::(HasMemAddressStateDB m, HasStorageDB m, HasStateDB m, HasHashDB m)=>
                       Address->m [(MP.Key, Word256)]
getAllStorageKeyVals' owner = getAllStorageKeyValsDB owner
-}









--The following are the memory cache versions of the functions

putStorageKeyValMC::(HasMemAddressStateDB m, HasStorageDB m, HasStateDB m, HasHashDB m)=>
                  Address->Word256->Word256->m ()
putStorageKeyValMC owner key val = do
  theMap <- fmap snd getStorageDB
  putStorageMap $ M.insert (owner, key) val theMap
  
getStorageKeyValMC::(HasMemAddressStateDB m, HasStorageDB m, HasStateDB m, HasHashDB m)=>
                   Address->Word256->m Word256
getStorageKeyValMC owner key = do
  theMap <- fmap snd getStorageDB
  case M.lookup (owner, key) theMap of
   Just val -> return val
   Nothing -> getStorageKeyValDB owner key
    
getAllStorageKeyValsMC::(HasMemAddressStateDB m, HasStorageDB m, HasStateDB m, HasHashDB m)=>
                       Address->m [(MP.Key, Word256)]
getAllStorageKeyValsMC owner = getAllStorageKeyValsDB owner

flushMemStorageDB::(HasMemAddressStateDB m, HasStateDB m, HasStorageDB m, HasHashDB m)=>
                   m ()
flushMemStorageDB = do
  theMap <- fmap snd getStorageDB
  forM_ (M.toList theMap) $ \((address, key), val) -> do
     putStorageKeyValDB address key val
  putStorageMap M.empty








--The following are the DB versions of the functions


putStorageKeyValDB::(HasMemAddressStateDB m, HasStorageDB m, HasStateDB m, HasHashDB m)=>
                  Address->Word256->Word256->m ()
putStorageKeyValDB owner key 0 = do --when val=0, we actually delete the key from the database
  addressState <- getAddressState owner
  db <- fmap fst getStorageDB
  let mpdb = MP.MPDB{MP.ldb=db, MP.stateRoot=addressStateContractRoot addressState}
  newContractRoot <- fmap MP.stateRoot $ MP.deleteKey mpdb (N.pack $ (N.byte2Nibbles =<<) $ word256ToBytes key)
  putAddressState owner addressState{addressStateContractRoot=newContractRoot}
  
putStorageKeyValDB owner key val = do
  hashDBPut storageKeyNibbles
  addressState <- getAddressState owner
  db <- fmap fst getStorageDB
  let mpdb = MP.MPDB{MP.ldb=db, MP.stateRoot=addressStateContractRoot addressState}
  newContractRoot <- fmap MP.stateRoot $ MP.putKeyVal mpdb storageKeyNibbles (rlpEncode $ rlpSerialize $ rlpEncode val)
  putAddressState owner addressState{addressStateContractRoot=newContractRoot}
  where storageKeyNibbles = N.pack $ (N.byte2Nibbles =<<) $ word256ToBytes key

getStorageKeyValDB::(HasMemAddressStateDB m, HasStorageDB m, HasStateDB m, HasHashDB m)=>
                   Address->Word256->m Word256
getStorageKeyValDB owner key = do
  addressState <- getAddressState owner
  db <- fmap fst getStorageDB
  let mpdb = MP.MPDB{MP.ldb=db, MP.stateRoot=addressStateContractRoot addressState}
  maybeVal <- MP.getKeyVal mpdb (N.pack $ (N.byte2Nibbles =<<) $ word256ToBytes key)
  case maybeVal of
    Nothing -> return 0
    Just x -> return $ fromInteger $ rlpDecode $ rlpDeserialize $ rlpDecode x

getAllStorageKeyValsDB::(HasMemAddressStateDB m, HasStorageDB m, HasStateDB m, HasHashDB m)=>
                       Address->m [(MP.Key, Word256)]
getAllStorageKeyValsDB owner = do
  addressState <- getAddressState owner
  db <- fmap fst getStorageDB
  let mpdb = MP.MPDB{MP.ldb=db, MP.stateRoot=addressStateContractRoot addressState}
  kvs <- MP.unsafeGetAllKeyVals mpdb
  return $ map (fmap $ fromInteger . rlpDecode . rlpDeserialize . rlpDecode) kvs
