{-# OPTIONS -fno-warn-redundant-constraints #-}
-- todo fixme
{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE IncoherentInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.DB.MemAddressStateDB
  ( MemAddressStateDB (..),
    runNewMemAddressStateDB,
    HasMemAddressStateDB (..),
    AddressStateModification (..),
    getAddressStateMaybe,
    putAddressState,
    putAddressStates,
    flushMemAddressStateTxToBlockDB,
    flushMemAddressStateDB,
    deleteAddressState,
    deleteAddressStates,
  )
where

import qualified Blockchain.DB.AddressStateDB as DB
import Blockchain.DB.HashDB
import Blockchain.DB.StateDB
import Blockchain.Data.AddressStateDB
import Blockchain.Strato.Model.Address
import Control.DeepSeq
import Data.Binary
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import Control.Monad.IO.Class
import Control.Monad.Trans.Class
import Control.Monad.Trans.State.Strict
import qualified Data.Map as M
import GHC.Generics
import Text.Format

newtype MemAddressStateDB m a = MemAddressStateDB {unMemAddressStateDB :: StateT (M.Map Address AddressState) m a}
  deriving (Functor, Applicative, Monad, MonadIO)

instance MonadTrans MemAddressStateDB where
  lift = MemAddressStateDB . lift

instance Monad m => (Address `A.Alters` AddressState) (MemAddressStateDB m) where
  lookup _ = MemAddressStateDB . gets . M.lookup
  insert _ k = MemAddressStateDB . modify' . M.insert k
  delete _ = MemAddressStateDB . modify' . M.delete

instance {-# OVERLAPPING #-} Monad m => A.Selectable Address AddressState (MemAddressStateDB m) where
  select = A.lookup

runMemAddressStateDB :: Monad m => MemAddressStateDB m a -> M.Map Address AddressState -> m a
runMemAddressStateDB f m = evalStateT (unMemAddressStateDB f) m

runNewMemAddressStateDB :: Monad m => MemAddressStateDB m a -> m a
runNewMemAddressStateDB f = runMemAddressStateDB f M.empty

data AddressStateModification = ASModification AddressState | ASDeleted deriving (Show, Eq, Generic)

instance NFData AddressStateModification

instance Binary AddressStateModification

instance Format AddressStateModification where
  format (ASModification addressState) = "Address Modified:\n" ++ format addressState
  format ASDeleted = "Address Deleted"

class HasMemAddressStateDB m where
  getAddressStateTxDBMap :: m (M.Map Address AddressStateModification)
  putAddressStateTxDBMap :: M.Map Address AddressStateModification -> m ()
  getAddressStateBlockDBMap :: m (M.Map Address AddressStateModification)
  putAddressStateBlockDBMap :: M.Map Address AddressStateModification -> m ()

getAddressStateMaybe ::
  (HasMemAddressStateDB m, HasStateDB m, HasHashDB m) =>
  Address ->
  m (Maybe AddressState)
getAddressStateMaybe address = do
  theMap <- getAddressStateTxDBMap
  case M.lookup address theMap of
    Just (ASModification addressState) -> return $ Just addressState
    Just ASDeleted -> return $ Just blankAddressState
    Nothing -> do
      theBMap <- getAddressStateBlockDBMap
      case M.lookup address theBMap of
        Just (ASModification addressState) -> return $ Just addressState
        Just ASDeleted -> return $ Just blankAddressState
        Nothing -> DB.getAddressStateMaybe address

putAddressState ::
  (HasMemAddressStateDB m, HasStateDB m, HasHashDB m) =>
  Address ->
  AddressState ->
  m ()
putAddressState address newState = do
  theMap <- getAddressStateTxDBMap
  putAddressStateTxDBMap (M.insert address (ASModification newState) theMap)

putAddressStates ::
  (HasMemAddressStateDB m, HasStateDB m, HasHashDB m) =>
  M.Map Address AddressStateModification ->
  m ()
putAddressStates localMap = do
  txMap <- getAddressStateTxDBMap
  putAddressStateTxDBMap $ localMap `M.union` txMap

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
  theMap <- getAddressStateBlockDBMap
  forM_ (M.toList theMap) $ \(address, modification) -> do
    case modification of
      ASModification addressState -> DB.putAddressState address addressState
      ASDeleted -> DB.deleteAddressState address
  putAddressStateBlockDBMap M.empty

deleteAddressState ::
  (HasMemAddressStateDB m, HasStateDB m) =>
  Address ->
  m ()
deleteAddressState address = do
  theMap <- getAddressStateTxDBMap
  putAddressStateTxDBMap (M.insert address ASDeleted theMap)

deleteAddressStates ::
  (HasMemAddressStateDB m, HasStateDB m) =>
  [Address] ->
  m ()
deleteAddressStates addresses = do
  theMap <- getAddressStateTxDBMap
  putAddressStateTxDBMap . M.difference theMap . M.fromList $ (,ASDeleted) <$> addresses
