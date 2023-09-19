{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.DB.StorageDB
  ( HasStorageDB,
    HasMemStorageDB,
    putStorageKeyVal',
    getStorageKeyVal',
    getAllStorageKeyVals',
    flushMemStorageTxDBToBlockDB,
    flushMemStorageDB,
  )
where

import BlockApps.Logging
import Blockchain.DB.HashDB
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.RawStorageDB
import Blockchain.DB.StateDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.ExtendedWord
import Control.Monad.Change.Alter (Alters)
import Data.Bifunctor (second)

-- A thin layer around raw storage db for clients who expect to work on
-- keys and values of Word256
type HasStorageDB m = HasRawStorageDB m

type HasMemStorageDB m = HasMemRawStorageDB m

type FullStorage m =
  ( HasMemAddressStateDB m,
    HasStorageDB m,
    HasMemStorageDB m,
    HasStateDB m,
    HasHashDB m,
    (Account `Alters` AddressState) m
  )

toKey :: Account -> Word256 -> RawStorageKey
toKey = curry $ fmap word256ToBytes

toVal :: Word256 -> RawStorageValue
toVal = rlpSerialize . rlpEncode

fromVal :: RawStorageValue -> Word256
fromVal = rlpDecode . rlpDeserialize

putStorageKeyVal' :: HasStorageDB m => Account -> Word256 -> Word256 -> m ()
putStorageKeyVal' acct key val = putRawStorageKeyVal' (toKey acct key) (toVal val)

getStorageKeyVal' :: HasStorageDB m => Account -> Word256 -> m Word256
getStorageKeyVal' acct key = fromVal <$> getRawStorageKeyVal' (toKey acct key)

getAllStorageKeyVals' :: FullStorage m => Account -> m [(MP.Key, Word256)]
getAllStorageKeyVals' acct = map (second fromVal) <$> getAllRawStorageKeyVals' acct

flushMemStorageTxDBToBlockDB :: FullStorage m => m ()
flushMemStorageTxDBToBlockDB = flushMemRawStorageTxDBToBlockDB

flushMemStorageDB :: (MonadLogger m, FullStorage m) => m ()
flushMemStorageDB = flushMemRawStorageDB
