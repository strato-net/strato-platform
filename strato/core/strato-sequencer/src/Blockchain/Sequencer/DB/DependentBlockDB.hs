{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

-- | The sequencer's record of which blocks it has emitted and which are
-- parked waiting for a parent.
--
-- Writes are staged in memory and only reach LevelDB through
-- 'commitDependentBlockDB'. The sequencer commits right after each write of
-- its output log, so an 'Emitted' mark can never be durable before the
-- 'VmBlock' it stands for. If the process dies in between, both are lost
-- together and the block is emitted again once p2p re-delivers it. The other
-- order was the cause of the vm_tasks gaps: a mark that outlived its unwritten
-- block made 'claimBlockForEmission' refuse that block forever.
--
-- Reads see staged writes, so between commits the DB behaves exactly as if
-- every write had been applied at once.
module Blockchain.Sequencer.DB.DependentBlockDB (
  DependentBlockDB(..),
  DependentBlockEntry,
  bootstrapGenesisBlock,
  lookupDependentBlockDB,
  insertDependentBlockDB,
  deleteDependentBlockDB,
  commitDependentBlockDB,
  insertEmitted,
  isBlockReadyForEmission,
  cacheBlockUntilParentEmitted,
  claimBlockForEmission,
  markBlockEmitted,
  openDependentBlockDB,
  runWithDependentBlockDB
  ) where

import BlockApps.Logging
import Blockchain.Data.BlockHeader
import Blockchain.Model.WrappedBlock
import Blockchain.Strato.Model.Keccak256
import Control.Monad (unless)
import Control.Monad.Change.Alter
import Control.Monad.Change.Modify
import Control.Monad.Composable.Base (Eff, InternalState, provide, runEff, withResources)
import Control.Monad.IO.Class
import Control.Monad.Trans.Resource (MonadResource)
import Data.Binary
import qualified Data.ByteString.Lazy as B
import Data.IORef
import qualified Data.Map.Strict as M
import qualified Data.Text as T
import qualified Database.LevelDB as LDB
import qualified GHC.Generics as GHCG
import Text.Format
import Prelude hiding (lookup)

data DependentBlockDB = DependentBlockDB
  { getDependentBlockDB :: LDB.DB,
    -- | Writes waiting for 'commitDependentBlockDB'; 'Nothing' is a delete.
    stagedDependentBlockDB :: IORef (M.Map Keccak256 (Maybe DependentBlockEntry))
  }

-- totalDifficulty always includes the difficulty of the block currently being operated on
data DependentBlockEntry
  = DependentBlocks {blocks :: [SequencedBlock]}
  | Emitted -- , qq :: Keccak256}
  | ChildFailedConsensus
      { blocks :: [SequencedBlock]
      }
  deriving (Eq, Show, GHCG.Generic)

instance Binary DependentBlockEntry

openDependentBlockDB ::
  MonadResource m =>
  FilePath ->  -- ^ Path to the LevelDB database
  Int ->       -- ^ Cache size (0 = 8MB default)
  m DependentBlockDB
openDependentBlockDB dbPath cacheSize =
  DependentBlockDB
    <$> LDB.open dbPath LDB.defaultOptions {LDB.createIfMissing = True, LDB.cacheSize = cacheSize}
    <*> liftIO (newIORef M.empty)

lookupDependentBlockDB :: (MonadIO m, Accessible DependentBlockDB m) =>
                          Keccak256 -> m (Maybe DependentBlockEntry)
lookupDependentBlockDB k = do
  DependentBlockDB db staged <- access (Proxy @DependentBlockDB)
  M.lookup k <$> liftIO (readIORef staged) >>= \case
    Just pending -> return pending
    Nothing -> fmap (decode . B.fromStrict) <$> LDB.get db LDB.defaultReadOptions (B.toStrict $ encode k)

insertDependentBlockDB :: (MonadIO m, Accessible DependentBlockDB m) =>
                          Keccak256 -> DependentBlockEntry -> m ()
insertDependentBlockDB k = stageDependentBlockDB k . Just

deleteDependentBlockDB :: (MonadIO m, Accessible DependentBlockDB m) =>
                          Keccak256 -> m ()
deleteDependentBlockDB k = stageDependentBlockDB k Nothing

stageDependentBlockDB :: (MonadIO m, Accessible DependentBlockDB m) =>
                         Keccak256 -> Maybe DependentBlockEntry -> m ()
stageDependentBlockDB k v = do
  staged <- stagedDependentBlockDB <$> access (Proxy @DependentBlockDB)
  liftIO $ modifyIORef' staged (M.insert k v)

-- | Apply the staged writes to LevelDB in one batch. Call it only once the
-- output those writes describe has itself been written (see the module note).
commitDependentBlockDB :: (MonadIO m, Accessible DependentBlockDB m) => m ()
commitDependentBlockDB = do
  DependentBlockDB db staged <- access (Proxy @DependentBlockDB)
  pending <- liftIO $ readIORef staged
  unless (M.null pending) $ do
    LDB.write db LDB.defaultWriteOptions
      [ maybe (LDB.Del k') (LDB.Put k' . B.toStrict . encode) v
      | (k, v) <- M.toList pending, let k' = B.toStrict (encode k) ]
    liftIO $ writeIORef staged M.empty

bootstrapGenesisBlock :: (Keccak256 `Alters` DependentBlockEntry) m => Keccak256 -> m ()
bootstrapGenesisBlock hash' = insert Proxy hash' Emitted

existingParent :: (Keccak256 `Alters` DependentBlockEntry) m => SequencedBlock -> m (Maybe DependentBlockEntry)
existingParent = lookup Proxy . parentHash . sbBlockData

isBlockReadyForEmission :: (Keccak256 `Alters` DependentBlockEntry) m => SequencedBlock -> m Bool
isBlockReadyForEmission b =
  existingParent b >>= \case
    Just Emitted ->
      return True
    Just (ChildFailedConsensus existingDeps) | not (b `elem` existingDeps) ->
      return True
    _ ->
      return False

cacheBlockUntilParentEmitted :: (Keccak256 `Alters` DependentBlockEntry) m => SequencedBlock -> m ()
cacheBlockUntilParentEmitted b =
  existingParent b >>= \case
    Just (DependentBlocks existingDeps) | b `elem` existingDeps -> return () -- case of duplicate seen
    Just (DependentBlocks existingDeps) -> do
      insert Proxy (parentHash $ sbBlockData b) $ DependentBlocks (b : existingDeps)
    Just (ChildFailedConsensus existingDeps) | b `elem` existingDeps -> return () -- case of duplicate seen
    Nothing -> do
      insert Proxy (parentHash $ sbBlockData b) $ DependentBlocks [b]
    _ ->
      return ()

insertEmitted :: (Keccak256 `Alters` DependentBlockEntry) m => SequencedBlock -> m (Maybe OutputBlock)
insertEmitted b =
  existingParent b >>= \case
    Just Emitted -> do
      insert Proxy (sbHash b) $ Emitted
      return $ Just theBlock
    Just (ChildFailedConsensus existingDeps) | not (b `elem` existingDeps) -> do
      insert Proxy (sbHash b) $ Emitted
      return $ Just theBlock
    _ -> return Nothing
  where
    theBlock = sequencedBlockToOutputBlock b

claimBlockForEmission ::
  ( (Keccak256 `Alters` DependentBlockEntry) m,
    MonadLogger m
  ) =>
  SequencedBlock -> m (Maybe [SequencedBlock])
claimBlockForEmission b =
  lookup Proxy (sbHash b) >>= \case
    Nothing -> do
      $logDebugS "claimBlockForEmission" . T.pack $ "Got Nothing for " <> format (sbHash b)
      return $ Just []
    Just Emitted -> do
      $logDebugS "claimBlockForEmission" . T.pack $ "Got Emitted for " <> format (sbHash b)
      return Nothing
    Just (DependentBlocks blocks') -> do
      $logDebugS "claimBlockForEmission" . T.pack $ "Got DependentBlocks for " <> format (sbHash b)
      return $ Just blocks'
    Just (ChildFailedConsensus _) -> do
      $logDebugS "claimBlockForEmission" . T.pack $ "Got ChildFailedConsensus for " <> format (sbHash b)
      return Nothing

markBlockEmitted :: (Keccak256 `Alters` DependentBlockEntry) m => SequencedBlock -> m ()
markBlockEmitted b = insert Proxy (sbHash b) Emitted

instance (MonadIO m, Accessible DependentBlockDB m) => (Keccak256 `Alters` DependentBlockEntry) m where
  lookup _ k = lookupDependentBlockDB k
  insert _ k v = insertDependentBlockDB k v
  delete _ k = deleteDependentBlockDB k

-- | Run an action that only needs 'DependentBlockDB' access, then commit it.
--
-- This opens a LevelDB database at the given path and provides the minimal
-- monad needed to run operations like 'bootstrapGenesisBlock'.
runWithDependentBlockDB ::
  FilePath ->  -- ^ Path to the LevelDB database
  Int ->       -- ^ Cache size (0 = 8MB default)
  Eff '[DependentBlockDB, InternalState] a ->
  IO a
runWithDependentBlockDB dbPath cacheSize action = runEff . withResources $ do
  db <- openDependentBlockDB dbPath cacheSize
  provide db (action <* commitDependentBlockDB)
