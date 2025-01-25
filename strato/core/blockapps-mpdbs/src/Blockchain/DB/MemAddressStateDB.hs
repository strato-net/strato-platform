{-# OPTIONS -fno-warn-redundant-constraints #-}
-- todo fixme
{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE IncoherentInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.DB.MemAddressStateDB
  ( MemAddressStateDB (..),
    runNewMemAddressStateDB,
    HasMemAddressStateDB (..),
    AddressStateModification (..),
    getAddressStateMaybe,
    putAddressState,
    flushMemAddressStateTxToBlockDB,
    flushMemAddressStateDB,
    deleteAddressState
  )
where

import qualified Blockchain.DB.AddressStateDB as DB
import Blockchain.DB.HashDB
import Blockchain.DB.StateDB
import Blockchain.Data.AddressStateDB
import Blockchain.Strato.Model.Account
import Control.DeepSeq
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import Control.Monad.IO.Class
import Control.Monad.Trans.Class
import Control.Monad.Trans.State.Strict
import qualified Data.Map as M
import GHC.Generics
import Text.Format

newtype MemAddressStateDB m a = MemAddressStateDB {unMemAddressStateDB :: StateT (M.Map Account AddressState) m a}
  deriving (Functor, Applicative, Monad, MonadIO)

instance MonadTrans MemAddressStateDB where
  lift = MemAddressStateDB . lift

instance Monad m => (Account `A.Alters` AddressState) (MemAddressStateDB m) where
  lookup _ = MemAddressStateDB . gets . M.lookup
  insert _ k = MemAddressStateDB . modify' . M.insert k
  delete _ = MemAddressStateDB . modify' . M.delete

instance Monad m => A.Selectable Account AddressState (MemAddressStateDB m) where
  select = A.lookup

runMemAddressStateDB :: Monad m => MemAddressStateDB m a -> M.Map Account AddressState -> m a
runMemAddressStateDB f m = evalStateT (unMemAddressStateDB f) m

runNewMemAddressStateDB :: Monad m => MemAddressStateDB m a -> m a
runNewMemAddressStateDB f = runMemAddressStateDB f M.empty

data AddressStateModification = ASModification AddressState | ASDeleted deriving (Show, Eq, Generic)

instance NFData AddressStateModification

instance Format AddressStateModification where
  format (ASModification addressState) = "Address Modified:\n" ++ format addressState
  format ASDeleted = "Address Deleted"

class HasMemAddressStateDB m where
  getAddressStateTxDBMap :: m (M.Map Account AddressStateModification)
  putAddressStateTxDBMap :: M.Map Account AddressStateModification -> m ()
  getAddressStateBlockDBMap :: m (M.Map Account AddressStateModification)
  putAddressStateBlockDBMap :: M.Map Account AddressStateModification -> m ()

getAddressStateMaybe ::
  (HasMemAddressStateDB m, HasStateDB m, HasHashDB m) =>
  Account ->
  m (Maybe AddressState)
getAddressStateMaybe account = do
  theMap <- getAddressStateTxDBMap
  case M.lookup account theMap of
    Just (ASModification addressState) -> return $ Just addressState
    Just ASDeleted -> return $ Just blankAddressState
    Nothing -> do
      theBMap <- getAddressStateBlockDBMap
      case M.lookup account theBMap of
        Just (ASModification addressState) -> return $ Just addressState
        Just ASDeleted -> return $ Just blankAddressState
        Nothing -> DB.getAddressStateMaybe account

putAddressState ::
  (HasMemAddressStateDB m, HasStateDB m, HasHashDB m) =>
  Account ->
  AddressState ->
  m ()
putAddressState account newState = do
  theMap <- getAddressStateTxDBMap
  putAddressStateTxDBMap (M.insert account (ASModification newState) theMap)

flushMemAddressStateTxToBlockDB ::
  (HasMemAddressStateDB m, HasStateDB m, HasHashDB m) =>
  m ()
flushMemAddressStateTxToBlockDB = do
  txMap <- getAddressStateTxDBMap
  blkMap <- getAddressStateBlockDBMap
  putAddressStateBlockDBMap $ txMap `M.union` blkMap
  putAddressStateTxDBMap M.empty

flushMemAddressStateDB ::
  (HasMemAddressStateDB m, HasStateDB m, HasHashDB m) =>
  m ()
flushMemAddressStateDB = do
  flushMemAddressStateTxToBlockDB
  theMap <- getAddressStateBlockDBMap
  forM_ (M.toList theMap) $ \(account, modification) -> do
    case modification of
      ASModification addressState -> DB.putAddressState account addressState
      ASDeleted -> DB.deleteAddressState account
  putAddressStateBlockDBMap M.empty

deleteAddressState ::
  (HasMemAddressStateDB m, HasStateDB m) =>
  Account ->
  m ()
deleteAddressState account = do
  theMap <- getAddressStateTxDBMap
  putAddressStateTxDBMap (M.insert account ASDeleted theMap)
