{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.DB.StorageDB
  ( HasStorageDB,
    HasMemStorageDB,
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
import Blockchain.Strato.Model.Address
import Control.Monad.Change.Alter (Alters)

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
    (Address `Alters` AddressState) m
  )

flushMemStorageTxDBToBlockDB :: FullStorage m => m ()
flushMemStorageTxDBToBlockDB = flushMemRawStorageTxDBToBlockDB

flushMemStorageDB :: (MonadLogger m, FullStorage m) => m ()
flushMemStorageDB = flushMemRawStorageDB
