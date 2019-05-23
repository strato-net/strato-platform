{-# LANGUAGE ConstraintKinds  #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE MonoLocalBinds   #-}
{-# LANGUAGE TypeOperators    #-}
module Blockchain.DB.SolidStorageDB (
  HasSolidStorageDB,
  HasMemSolidStorageDB,
  putSolidStorageKeyVal',
  getSolidStorageKeyVal',
  getAllSolidStorageKeyVals',
  flushMemSolidStorageTxDBToBlockDB,
  flushMemSolidStorageDB,
  FullSolidStorage
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
import           SolidVM.Model.Storable

type HasSolidStorageDB m = HasRawStorageDB m

type HasMemSolidStorageDB m = HasMemRawStorageDB m

type FullSolidStorage m = ( HasMemAddressStateDB m
                          , HasSolidStorageDB m
                          , HasMemSolidStorageDB m
                          , HasStateDB m
                          , HasHashDB m
                          , (Address `Alters` AddressState) m
                          )

toKey :: Address -> StoragePath -> RawStorageKey
toKey =  curry $ fmap unparsePath

toVal :: BasicValue -> RawStorageValue
toVal = rlpSerialize  . rlpEncode

fromVal :: RawStorageValue -> BasicValue
fromVal = rlpDecode . rlpDeserialize

putSolidStorageKeyVal' :: FullSolidStorage m => Address -> StoragePath -> BasicValue -> m ()
putSolidStorageKeyVal' addr key val = do
  putRawStorageKeyVal' (toKey addr key) (toVal val)

getSolidStorageKeyVal' :: FullSolidStorage m => Address -> StoragePath -> m BasicValue
getSolidStorageKeyVal' addr key = do
  v' <- fromVal <$> getRawStorageKeyVal' (toKey addr key)
  return v'

getAllSolidStorageKeyVals' :: FullSolidStorage m => Address -> m [(MP.Key, BasicValue)]
getAllSolidStorageKeyVals' addr = map (second fromVal) <$> getAllRawStorageKeyVals' addr

flushMemSolidStorageTxDBToBlockDB :: FullSolidStorage m => m ()
flushMemSolidStorageTxDBToBlockDB = flushMemRawStorageTxDBToBlockDB

flushMemSolidStorageDB :: (FullSolidStorage m, m `Outputs` String) => m ()
flushMemSolidStorageDB = flushMemRawStorageDB
