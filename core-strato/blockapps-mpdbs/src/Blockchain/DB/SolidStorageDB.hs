{-# LANGUAGE ConstraintKinds #-}
module Blockchain.DB.SolidStorageDB (
  HasSolidStorageDB,
  putSolidStorageKeyVal',
  getSolidStorageKeyVal',
  getAllSolidStorageKeyVals',
  flushSolidStorageTxDBToBlockDB,
  flushMemSolidStorageDB
  ) where

import Debug.Trace
import           Data.Bifunctor                              (second)
import qualified Data.ByteString                             as B

import           Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia          as MP
import           Blockchain.DB.HashDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.RawStorageDB
import           Blockchain.DB.StateDB
import           Blockchain.Strato.Model.Address
import           SolidVM.Model.Storable

type HasSolidStorageDB = HasRawStorageDB

type FullSolidStorage m = (HasMemAddressStateDB m, HasSolidStorageDB m, HasStateDB m, HasHashDB m)

toKey :: StoragePath -> B.ByteString
toKey = unparsePath

toVal :: BasicValue -> B.ByteString
toVal = rlpSerialize  . rlpEncode

fromVal :: B.ByteString -> BasicValue
fromVal = rlpDecode . rlpDeserialize

putSolidStorageKeyVal' :: FullSolidStorage m => Address -> StoragePath -> BasicValue -> m ()
putSolidStorageKeyVal' addr key val = do
  traceShowM ("putSolidStorage: ", key, val)
  putRawStorageKeyVal' addr (toKey key) (toVal val)

getSolidStorageKeyVal' :: FullSolidStorage m => Address -> StoragePath -> m BasicValue
getSolidStorageKeyVal' addr key = do
  v <- fromVal <$> getRawStorageKeyVal' addr (toKey key)
  traceShowM ("getSolidStorage: ", key, v)
  return v

getAllSolidStorageKeyVals' :: FullSolidStorage m => Address -> m [(MP.Key, BasicValue)]
getAllSolidStorageKeyVals' addr = map (second fromVal) <$> getAllRawStorageKeyVals' addr

flushSolidStorageTxDBToBlockDB :: FullSolidStorage m => m ()
flushSolidStorageTxDBToBlockDB = flushRawStorageTxDBToBlockDB

flushMemSolidStorageDB :: FullSolidStorage m => m ()
flushMemSolidStorageDB = flushMemRawStorageDB
