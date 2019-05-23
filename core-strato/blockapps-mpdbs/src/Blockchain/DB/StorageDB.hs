{-# LANGUAGE ConstraintKinds  #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE MonoLocalBinds   #-}
{-# LANGUAGE TypeOperators    #-}
module Blockchain.DB.StorageDB (
  HasStorageDB,
  HasMemStorageDB,
  putStorageKeyVal',
  getStorageKeyVal',
  getAllStorageKeyVals',
  flushMemStorageTxDBToBlockDB,
  flushMemStorageDB
  ) where

import           Control.Monad.Change.Alter                  (Alters)
import           Control.Monad.Change.Modify                 (Outputs)
import           Data.Bifunctor                              (second)

import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia          as MP
import           Blockchain.DB.HashDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.RawStorageDB
import           Blockchain.DB.StateDB
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ExtendedWord

-- A thin layer around raw storage db for clients who expect to work on
-- keys and values of Word256
type HasStorageDB m = HasRawStorageDB m

type HasMemStorageDB m = HasMemRawStorageDB m

type FullStorage m = ( HasMemAddressStateDB m
                     , HasStorageDB m
                     , HasMemStorageDB m
                     , HasStateDB m
                     , HasHashDB m
                     , (Address `Alters` AddressState) m
                     )

toKey :: Address -> Word256 -> RawStorageKey
toKey = curry $ fmap word256ToBytes

toVal :: Word256 -> RawStorageValue
toVal = rlpSerialize  . rlpEncode

fromVal :: RawStorageValue -> Word256
fromVal = rlpDecode . rlpDeserialize

putStorageKeyVal' :: HasStorageDB m => Address -> Word256 -> Word256 -> m ()
putStorageKeyVal' addr key val = putRawStorageKeyVal' (toKey addr key) (toVal val)

getStorageKeyVal' :: HasStorageDB m => Address -> Word256 -> m Word256
getStorageKeyVal' addr key = fromVal <$> getRawStorageKeyVal' (toKey addr key)

getAllStorageKeyVals' :: FullStorage m => Address -> m [(MP.Key, Word256)]
getAllStorageKeyVals' addr = map (second fromVal) <$> getAllRawStorageKeyVals' addr

flushMemStorageTxDBToBlockDB :: FullStorage m => m ()
flushMemStorageTxDBToBlockDB = flushMemRawStorageTxDBToBlockDB

flushMemStorageDB :: (FullStorage m, m `Outputs` String) => m ()
flushMemStorageDB = flushMemRawStorageDB
