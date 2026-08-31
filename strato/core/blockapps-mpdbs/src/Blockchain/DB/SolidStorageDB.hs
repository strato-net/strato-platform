{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.DB.SolidStorageDB
  ( HasSolidStorageDB,
    HasMemSolidStorageDB,
    putSolidStorageKeyVal',
    putSolidStorageKeyVals',
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
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Strato.Model.Address
import Control.Monad.Change.Alter (Alters)
import qualified Control.Monad.Change.Alter as A
import Control.Monad.IO.Class (MonadIO)
import Data.Bifunctor (second)
import qualified Data.Map as M
import SolidVM.Model.Storable

type HasSolidStorageDB m = HasRawStorageDB m

type HasMemSolidStorageDB m = HasMemRawStorageDB m

type FullSolidStorage m =
  ( HasMemAddressStateDB m,
    HasSolidStorageDB m,
    HasMemSolidStorageDB m,
    HasStateDB m,
    HasHashDB m,
    (Address `Alters` AddressState) m
  )

toKey :: Address -> StoragePath -> RawStorageKey
toKey k v = (k, v)

toVal :: BasicValue -> RawStorageValue
toVal bv =
  if isDefault bv
    then BDefault
    else bv

fromVal :: RawStorageValue -> BasicValue
fromVal = id

putSolidStorageKeyVal' :: HasSolidStorageDB m => Address -> StoragePath -> BasicValue -> m ()
putSolidStorageKeyVal' address key val = do
  putRawStorageKeyVal' (toKey address key) (toVal val)

putSolidStorageKeyVals' :: HasSolidStorageDB m => M.Map (Address, StoragePath) BasicValue -> m ()
putSolidStorageKeyVals' = A.insertMany A.Proxy . M.map toVal

getSolidStorageKeyVal' :: HasSolidStorageDB m => Address -> StoragePath -> m BasicValue
getSolidStorageKeyVal' address key = do
  v' <- fromVal <$> getRawStorageKeyVal' (toKey address key)
  return v'

deleteSolidStorageKeyVal' :: HasSolidStorageDB m => Address -> StoragePath -> m ()
deleteSolidStorageKeyVal' acct key = deleteRawStorageKey' (toKey acct key)

getAllSolidStorageKeyVals' :: FullSolidStorage m => Address -> m [(MP.Key, BasicValue)]
getAllSolidStorageKeyVals' acct = map (second fromVal) <$> getAllRawStorageKeyVals' acct

flushMemSolidStorageTxDBToBlockDB :: FullSolidStorage m => m ()
flushMemSolidStorageTxDBToBlockDB = flushMemRawStorageTxDBToBlockDB

flushMemSolidStorageDB :: (MonadIO m, MonadLogger m, FullSolidStorage m) => m ()
flushMemSolidStorageDB = flushMemRawStorageDB
