{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TypeOperators #-}

-- | The state database as a composable monad layer: the trie node store plus
-- the root cursor (which state root each chain is at, under the block being
-- worked on). Code that reads or writes state asks for 'HasStateDB'; providing
-- a 'StateDBEnv' in the row satisfies it.
module Control.Monad.Composable.StateDB
  ( StateDBEnv (..),
    StateDBM,
    HasStateDB,
    CurrentBlockHash (..),
    newStateDBEnv,
    runStateDBM,
    snapshotStateDBEnv,
    restoreStateDBEnv,
    clearStateRoots,
    getFlushedRoot,
    setFlushedRoot,
    tickNodeDB,
    flushNodeDB,
    module Control.Monad.Composable.NodeDB,
  )
where

import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Strato.Model.ExtendedWord (Word256)
import Blockchain.Strato.Model.Keccak256 (Keccak256, unsafeCreateKeccak256FromWord256)
import Control.DeepSeq (NFData)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Base
import Control.Monad.Composable.NodeDB
import Control.Monad (join)
import Control.Monad.IO.Class
import Data.Foldable (for_)
import Data.IORef
import qualified Data.Map as M
import Data.Maybe (fromMaybe)
import Data.Traversable (for)
import GHC.Generics (Generic)

newtype CurrentBlockHash = CurrentBlockHash {unCurrentBlockHash :: Keccak256}
  deriving (Generic, NFData, Show)

data StateDBEnv = StateDBEnv
  { nodes :: NodeDB,
    stateRoots :: IORef (M.Map (Keccak256, Maybe Word256) MP.StateRoot),
    currentBlock :: IORef (Maybe CurrentBlockHash),
    -- | The root the last flush of the block maps produced.
    flushedRoot :: IORef (Maybe MP.StateRoot)
  }

type StateDBM es = Eff (StateDBEnv ': es)

type HasStateDB m =
  ( (MP.StateRoot `A.Alters` MP.NodeData) m,
    (Maybe Word256 `A.Alters` MP.StateRoot) m
  )

newStateDBEnv :: MonadIO m => NodeDB -> m StateDBEnv
newStateDBEnv db = liftIO $ StateDBEnv db <$> newIORef M.empty <*> newIORef Nothing <*> newIORef Nothing

runStateDBM :: StateDBEnv -> StateDBM es a -> Eff es a
runStateDBM = provide

-- | A copy of the cursor over the same node store; writes to it leave the
-- original alone.
snapshotStateDBEnv :: MonadIO m => StateDBEnv -> m StateDBEnv
snapshotStateDBEnv e = liftIO $ StateDBEnv (nodes e) <$> copy (stateRoots e) <*> copy (currentBlock e) <*> copy (flushedRoot e)
  where
    copy r = newIORef =<< readIORef r

-- | Put the cursor back to what a snapshot holds.
restoreStateDBEnv :: MonadIO m => StateDBEnv -> StateDBEnv -> m ()
restoreStateDBEnv e snap = liftIO $ do
  put (stateRoots e) (stateRoots snap)
  put (currentBlock e) (currentBlock snap)
  put (flushedRoot e) (flushedRoot snap)
  where
    put r s = writeIORef r =<< readIORef s

env :: (MonadIO m, AccessibleEnv StateDBEnv m) => (StateDBEnv -> IO a) -> m a
env f = accessEnv >>= liftIO . f

clearStateRoots :: (MonadIO m, AccessibleEnv StateDBEnv m) => m ()
clearStateRoots = env $ \e -> writeIORef (stateRoots e) M.empty

getFlushedRoot :: (MonadIO m, AccessibleEnv StateDBEnv m) => m (Maybe MP.StateRoot)
getFlushedRoot = env $ readIORef . flushedRoot

setFlushedRoot :: (MonadIO m, AccessibleEnv StateDBEnv m) => Maybe MP.StateRoot -> m ()
setFlushedRoot sr = env $ \e -> writeIORef (flushedRoot e) sr

tickNodeDB, flushNodeDB :: (MonadIO m, AccessibleEnv StateDBEnv m) => m ()
tickNodeDB = env $ tickNodes . nodes
flushNodeDB = env $ flushNodes . nodes

instance (StateDBEnv :> es) => (MP.StateRoot `A.Alters` MP.NodeData) (Eff es) where
  lookup _ k = env $ \e -> lookupNode (nodes e) k
  insert _ k v = env $ \e -> insertNode (nodes e) k v
  delete _ k = env $ \e -> deleteNode (nodes e) k

-- | The roots are kept per block; without a current block there is nothing
-- to look up or record.
instance (StateDBEnv :> es) => (Maybe Word256 `A.Alters` MP.StateRoot) (Eff es) where
  lookup _ chainId = env $ \e -> do
    mBH <- readIORef (currentBlock e)
    fmap join . for mBH $ \(CurrentBlockHash bh) ->
      M.lookup (bh, chainId) <$> readIORef (stateRoots e)
  insert _ chainId sr = env $ \e -> do
    mBH <- readIORef (currentBlock e)
    for_ mBH $ \(CurrentBlockHash bh) -> modifyIORef' (stateRoots e) (M.insert (bh, chainId) sr)
  delete _ chainId = env $ \e -> do
    mBH <- readIORef (currentBlock e)
    for_ mBH $ \(CurrentBlockHash bh) -> modifyIORef' (stateRoots e) (M.delete (bh, chainId))

instance (StateDBEnv :> es) => Mod.Modifiable CurrentBlockHash (Eff es) where
  get _ = env $ fmap (fromMaybe (CurrentBlockHash $ unsafeCreateKeccak256FromWord256 0)) . readIORef . currentBlock
  put _ bh = env $ \e -> writeIORef (currentBlock e) (Just bh)
