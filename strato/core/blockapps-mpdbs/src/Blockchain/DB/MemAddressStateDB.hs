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
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Database.MerklePatricia.Profile
import Blockchain.Strato.Model.Address
import Control.DeepSeq
import Data.Binary
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import Control.Monad.IO.Class
import Control.Monad.Trans.Class
import Control.Monad.Trans.State.Strict
import qualified Data.Map as M
import Data.IORef
import GHC.Generics
import System.IO.Unsafe (unsafePerformIO)
import Text.Format

{-# NOINLINE accountReadCache #-}
accountReadCache :: IORef (M.Map (MP.StateRoot, Address) (Maybe AddressState))
accountReadCache = unsafePerformIO $ newIORef M.empty

cacheAccountRead :: (MP.StateRoot, Address) -> Maybe AddressState -> IO ()
cacheAccountRead key value = modifyIORef' accountReadCache $ \cache ->
  M.insert key value $ if M.size cache >= 100000 then M.empty else cache

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
  (MonadIO m, HasMemAddressStateDB m, HasStateDB m, HasHashDB m) =>
  Address ->
  m (Maybe AddressState)
getAddressStateMaybe address = do
  liftIO $ do
    noteProfileAccount (show address)
    bumpDBProfile AccountReadOps 1
  theMap <- getAddressStateTxDBMap
  case M.lookup address theMap of
    Just (ASModification addressState) -> do
      liftIO $ bumpDBProfile AccountTxCacheHits 1
      return $ Just addressState
    Just ASDeleted -> do
      liftIO $ bumpDBProfile AccountTxCacheHits 1
      return $ Just blankAddressState
    Nothing -> do
      liftIO $ bumpDBProfile AccountTxCacheMisses 1
      theBMap <- getAddressStateBlockDBMap
      case M.lookup address theBMap of
        Just (ASModification addressState) -> do
          liftIO $ bumpDBProfile AccountBlockCacheHits 1
          return $ Just addressState
        Just ASDeleted -> do
          liftIO $ bumpDBProfile AccountBlockCacheHits 1
          return $ Just blankAddressState
        Nothing -> do
          liftIO $ bumpDBProfile AccountBlockCacheMisses 1
          root <- getStateRoot Nothing
          cache <- liftIO $ readIORef accountReadCache
          case M.lookup (root, address) cache of
            Just result -> do
              liftIO $ bumpDBProfile AccountReadCacheHits 1
              pure result
            Nothing -> do
              liftIO $ bumpDBProfile AccountReadCacheMisses 1
              result <- DB.getAddressStateMaybe address
              liftIO $ cacheAccountRead (root, address) result
              pure result

putAddressState ::
  (MonadIO m, HasMemAddressStateDB m, HasStateDB m, HasHashDB m) =>
  Address ->
  AddressState ->
  m ()
putAddressState address newState = do
  liftIO $ do
    noteProfileAccount (show address)
    bumpDBProfile AccountWriteOps 1
  theMap <- getAddressStateTxDBMap
  putAddressStateTxDBMap (M.insert address (ASModification newState) theMap)

putAddressStates ::
  (MonadIO m, HasMemAddressStateDB m, HasStateDB m, HasHashDB m) =>
  M.Map Address AddressStateModification ->
  m ()
putAddressStates localMap = do
  liftIO $ forM_ (M.keys localMap) $ \address -> do
    noteProfileAccount (show address)
    bumpDBProfile AccountWriteOps 1
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
  forM_ (M.toList theMap) $ \(address, modification) ->
    case modification of
      ASModification addressState -> DB.putAddressState address addressState
      ASDeleted -> DB.deleteAddressState address
  putAddressStateBlockDBMap M.empty

deleteAddressState ::
  (MonadIO m, HasMemAddressStateDB m, HasStateDB m) =>
  Address ->
  m ()
deleteAddressState address = do
  liftIO $ do
    noteProfileAccount (show address)
    bumpDBProfile AccountDeleteOps 1
  theMap <- getAddressStateTxDBMap
  putAddressStateTxDBMap (M.insert address ASDeleted theMap)

deleteAddressStates ::
  (MonadIO m, HasMemAddressStateDB m, HasStateDB m) =>
  [Address] ->
  m ()
deleteAddressStates addresses = do
  liftIO $ forM_ addresses $ \address -> do
    noteProfileAccount (show address)
    bumpDBProfile AccountDeleteOps 1
  theMap <- getAddressStateTxDBMap
  putAddressStateTxDBMap . M.difference theMap . M.fromList $ (,ASDeleted) <$> addresses
