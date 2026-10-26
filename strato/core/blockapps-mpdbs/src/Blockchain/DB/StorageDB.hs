{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.DB.StorageDB
  ( HasStorageDB,
    HasMemStorageDB,
    flushMemStorageDB,
  )
where

import BlockApps.Logging
import Blockchain.DB.AddressStateDB (HasAccountDB)
import Blockchain.DB.HashDB
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.RawStorageDB
import Blockchain.DB.StateDB

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
    HasAccountDB m
  )

flushMemStorageDB :: (MonadLogger m, FullStorage m) => m ()
flushMemStorageDB = flushMemRawStorageDB
