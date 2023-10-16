{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.DB.SolidStorageDB
  ( HasSolidStorageDB,
    HasMemSolidStorageDB,
    putSolidStorageKeyVal',
    getSolidStorageKeyVal',
    deleteSolidStorageKeyVal',
    getAllSolidStorageKeyVals',
    flushMemSolidStorageTxDBToBlockDB,
    flushMemSolidStorageDB,
    FullSolidStorage,
    fromVal,
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
import Control.Monad.Change.Alter (Alters)
import Data.Bifunctor (second)
import SolidVM.Model.Storable

type HasSolidStorageDB m = HasRawStorageDB m

type HasMemSolidStorageDB m = HasMemRawStorageDB m

type FullSolidStorage m =
  ( HasMemAddressStateDB m,
    HasSolidStorageDB m,
    HasMemSolidStorageDB m,
    HasStateDB m,
    HasHashDB m,
    (Account `Alters` AddressState) m
  )

toKey :: Account -> StoragePath -> RawStorageKey
toKey = curry $ fmap unparsePath

toVal :: BasicValue -> RawStorageValue
toVal bv =
  let v =
        if isDefault bv
          then BDefault
          else bv
   in rlpSerialize $ rlpEncode v

fromVal :: RawStorageValue -> BasicValue
fromVal = rlpDecode . rlpDeserialize

putSolidStorageKeyVal' :: HasSolidStorageDB m => Account -> StoragePath -> BasicValue -> m ()
putSolidStorageKeyVal' acct key val = do
  putRawStorageKeyVal' (toKey acct key) (toVal val)

getSolidStorageKeyVal' :: HasSolidStorageDB m => Account -> StoragePath -> m BasicValue
getSolidStorageKeyVal' acct key = do
  v' <- fromVal <$> getRawStorageKeyVal' (toKey acct key)
  return v'

deleteSolidStorageKeyVal' :: HasSolidStorageDB m => Account -> StoragePath -> m ()
deleteSolidStorageKeyVal' acct key = deleteRawStorageKey' (toKey acct key)

getAllSolidStorageKeyVals' :: FullSolidStorage m => Account -> m [(MP.Key, BasicValue)]
getAllSolidStorageKeyVals' acct = map (second fromVal) <$> getAllRawStorageKeyVals' acct

flushMemSolidStorageTxDBToBlockDB :: FullSolidStorage m => m ()
flushMemSolidStorageTxDBToBlockDB = flushMemRawStorageTxDBToBlockDB

flushMemSolidStorageDB :: (MonadLogger m, FullSolidStorage m) => m ()
flushMemSolidStorageDB = flushMemRawStorageDB
