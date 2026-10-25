{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE UndecidableInstances #-}

-- | The account database as a composable monad layer: the trie of accounts
-- (address to nonce, balance, code hash, storage root) whose root is a
-- block's state root. It holds the root cursor (which state root each chain
-- is at, under the block being worked on; the root the last flush produced)
-- and the write-back caches that are flushed into the tries at the end of a
-- block: the accounts, and the storage writes whose flush gives each account
-- its new storage root. Code that reads or writes accounts asks for
-- 'HasAccountDB'; providing an 'AccountDBEnv' in the row satisfies it.
module Control.Monad.Composable.AccountDB
  ( AccountDBEnv (..),
    AccountDBM,
    HasAccountDB,
    CurrentBlockHash (..),
    newAccountDBEnv,
    runAccountDBM,
    withHeaderRoot,
    snapshotAccountDBEnv,
    restoreAccountDBEnv,
    clearStateRoots,
    getFlushedRoot,
    setFlushedRoot,
  )
where

import Blockchain.DB.AddressStateDB (HasAccountDB)
import Blockchain.DB.MemAddressStateDB (AddressStateModification, BlockMap, HasMemAddressStateDB (..), emptyBlockMap)
import Blockchain.DB.RawStorageDB (HasMemRawStorageDB (..), RawStorageKey, RawStorageValue)
import Blockchain.Strato.Model.Address (Address)
import Blockchain.Strato.Model.ExtendedWord (Word256)
import Blockchain.Strato.Model.Keccak256 (Keccak256, unsafeCreateKeccak256FromWord256)
import Blockchain.Strato.Model.StateRoot (StateRoot)
import Control.DeepSeq (NFData)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Base
import Control.Monad.IO.Class
import Data.Foldable (for_)
import Data.IORef
import qualified Data.Map as M
import Data.Maybe (fromMaybe)
import GHC.Generics (Generic)

newtype CurrentBlockHash = CurrentBlockHash {unCurrentBlockHash :: Keccak256}
  deriving (Generic, NFData, Show)

data AccountDBEnv = AccountDBEnv
  { stateRoots :: IORef (M.Map (Keccak256, Maybe Word256) StateRoot),
    currentBlock :: IORef (Maybe CurrentBlockHash),
    -- | The root the last flush of the block caches produced.
    flushedRoot :: IORef (Maybe StateRoot),
    -- | The state root a block's header recorded, for a block the cursor has
    -- no entry for; see 'withHeaderRoot'.
    headerRoot :: Keccak256 -> IO (Maybe StateRoot),
    -- | Accounts modified by the current transaction.
    txAccounts :: IORef (M.Map Address AddressStateModification),
    -- | Accounts read or written during the block; flushed into the trie at
    -- its end.
    blockAccounts :: IORef (BlockMap Address AddressStateModification),
    -- | Storage read or written during the block; flushed into the accounts'
    -- storage tries at its end.
    blockStorage :: IORef (BlockMap RawStorageKey RawStorageValue)
  }

type AccountDBM es = Eff (AccountDBEnv ': es)

newAccountDBEnv :: MonadIO m => m AccountDBEnv
newAccountDBEnv =
  liftIO $
    AccountDBEnv <$> newIORef M.empty <*> newIORef Nothing <*> newIORef Nothing <*> pure (const (pure Nothing)) <*> newIORef M.empty <*> newIORef emptyBlockMap <*> newIORef emptyBlockMap

runAccountDBM :: AccountDBEnv -> AccountDBM es a -> Eff es a
runAccountDBM = provide

-- | Run the body with a block's header root looked up by @f@ when the cursor
-- has no entry for the block.
withHeaderRoot :: forall es a. (AccountDBEnv :> es) => (Keccak256 -> Eff es (Maybe StateRoot)) -> Eff es a -> Eff es a
withHeaderRoot f m = Eff $ \outer ->
  unEff (localEnv @AccountDBEnv (\e -> e {headerRoot = \bh -> unEff (f bh) outer}) m) outer

-- | A copy of the cursor and caches; writes to it leave the original alone.
snapshotAccountDBEnv :: MonadIO m => AccountDBEnv -> m AccountDBEnv
snapshotAccountDBEnv e =
  liftIO $
    AccountDBEnv <$> copy (stateRoots e) <*> copy (currentBlock e) <*> copy (flushedRoot e) <*> pure (headerRoot e) <*> copy (txAccounts e) <*> copy (blockAccounts e) <*> copy (blockStorage e)
  where
    copy r = newIORef =<< readIORef r

-- | Put the cursor and caches back to what a snapshot holds.
restoreAccountDBEnv :: MonadIO m => AccountDBEnv -> AccountDBEnv -> m ()
restoreAccountDBEnv e snap = liftIO $ do
  put (stateRoots e) (stateRoots snap)
  put (currentBlock e) (currentBlock snap)
  put (flushedRoot e) (flushedRoot snap)
  put (txAccounts e) (txAccounts snap)
  put (blockAccounts e) (blockAccounts snap)
  put (blockStorage e) (blockStorage snap)
  where
    put r s = writeIORef r =<< readIORef s

env :: (MonadIO m, AccessibleEnv AccountDBEnv m) => (AccountDBEnv -> IO a) -> m a
env f = accessEnv >>= liftIO . f

clearStateRoots :: (MonadIO m, AccessibleEnv AccountDBEnv m) => m ()
clearStateRoots = env $ \e -> writeIORef (stateRoots e) M.empty

getFlushedRoot :: (MonadIO m, AccessibleEnv AccountDBEnv m) => m (Maybe StateRoot)
getFlushedRoot = env $ readIORef . flushedRoot

setFlushedRoot :: (MonadIO m, AccessibleEnv AccountDBEnv m) => Maybe StateRoot -> m ()
setFlushedRoot sr = env $ \e -> writeIORef (flushedRoot e) sr

-- | The roots are kept per block; without a current block there is nothing
-- to look up or record.
instance (AccountDBEnv :> es) => (Maybe Word256 `A.Alters` StateRoot) (Eff es) where
  lookup _ chainId = env $ \e -> do
    mBH <- readIORef (currentBlock e)
    case mBH of
      Nothing -> pure Nothing
      Just (CurrentBlockHash bh) -> do
        mSR <- M.lookup (bh, chainId) <$> readIORef (stateRoots e)
        maybe (headerRoot e bh) (pure . Just) mSR
  insert _ chainId sr = env $ \e -> do
    mBH <- readIORef (currentBlock e)
    for_ mBH $ \(CurrentBlockHash bh) -> modifyIORef' (stateRoots e) (M.insert (bh, chainId) sr)
  delete _ chainId = env $ \e -> do
    mBH <- readIORef (currentBlock e)
    for_ mBH $ \(CurrentBlockHash bh) -> modifyIORef' (stateRoots e) (M.delete (bh, chainId))

instance (AccountDBEnv :> es) => Mod.Modifiable CurrentBlockHash (Eff es) where
  get _ = env $ fmap (fromMaybe (CurrentBlockHash $ unsafeCreateKeccak256FromWord256 0)) . readIORef . currentBlock
  put _ bh = env $ \e -> writeIORef (currentBlock e) (Just bh)

instance (AccountDBEnv :> es) => HasMemAddressStateDB (Eff es) where
  getAddressStateTxDBMap = env $ readIORef . txAccounts
  putAddressStateTxDBMap m = env $ \e -> writeIORef (txAccounts e) m
  getAddressStateBlockDBMap = env $ readIORef . blockAccounts
  putAddressStateBlockDBMap m = env $ \e -> writeIORef (blockAccounts e) m

instance (AccountDBEnv :> es) => HasMemRawStorageDB (Eff es) where
  getMemRawStorageBlockDB = env $ readIORef . blockStorage
  putMemRawStorageBlockMap m = env $ \e -> writeIORef (blockStorage e) m
