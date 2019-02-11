{-# LANGUAGE ConstraintKinds #-}
module Blockchain.DB.StorageDB (
  HasStorageDB,
  putStorageKeyVal',
  getStorageKeyVal',
  getAllStorageKeyVals',
  flushStorageTxDBToBlockDB,
  flushMemStorageDB
  ) where

import           Data.Bifunctor                              (second)
import qualified Data.ByteString                             as B

import           Blockchain.Data.Address
import           Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia          as MP
import           Blockchain.DB.HashDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.RawStorageDB
import           Blockchain.DB.StateDB
import           Blockchain.ExtWord

-- A thin layer around raw storage db for clients who expect to work on
-- keys and values of Word256
type HasStorageDB = HasRawStorageDB

type FullStorage m = (HasMemAddressStateDB m, HasStorageDB m, HasStateDB m, HasHashDB m)

toKey :: Word256 -> B.ByteString
toKey = word256ToBytes

toVal :: Word256 -> B.ByteString
toVal = rlpSerialize  . rlpEncode

fromVal :: B.ByteString -> Word256
fromVal = rlpDecode . rlpDeserialize

putStorageKeyVal' :: FullStorage m => Address -> Word256 -> Word256 -> m ()
putStorageKeyVal' addr key val = putRawStorageKeyVal' addr (toKey key) (toVal val)

getStorageKeyVal' :: FullStorage m => Address -> Word256 -> m Word256
getStorageKeyVal' addr key = fromVal <$> getRawStorageKeyVal' addr (toKey key)

getAllStorageKeyVals' :: FullStorage m => Address -> m [(MP.Key, Word256)]
getAllStorageKeyVals' addr = map (second fromVal) <$> getAllRawStorageKeyVals' addr

flushStorageTxDBToBlockDB :: FullStorage m => m ()
flushStorageTxDBToBlockDB = flushRawStorageTxDBToBlockDB

flushMemStorageDB :: FullStorage m => m ()
flushMemStorageDB = flushMemRawStorageDB
