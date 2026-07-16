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

module Blockchain.Sequencer.DB.DependentBlockDB (
  DependentBlockDB(..),
  DependentBlockEntry,
  bootstrapGenesisBlock,
  lookupDependentBlockDB,
  insertDependentBlockDB,
  deleteDependentBlockDB,
  insertEmitted,
  isBlockReadyForEmission,
  cacheBlockUntilParentEmitted,
  claimBlockForEmission,
  markBlockEmitted,
  runWithDependentBlockDB
  ) where

import BlockApps.Logging
import Blockchain.Data.BlockHeader
import Blockchain.Model.WrappedBlock
import Blockchain.Strato.Model.Keccak256
import Control.Monad.Change.Alter
import Control.Monad.Change.Modify
import Control.Monad.IO.Class
import Control.Monad.Trans.Reader (ReaderT, runReaderT)
import Control.Monad.Trans.Resource (runResourceT)
import Data.Binary
import qualified Data.ByteString.Lazy as B
import qualified Data.Text as T
import qualified Database.LevelDB as LDB
import qualified GHC.Generics as GHCG
import Text.Format
import Prelude hiding (lookup)

newtype DependentBlockDB = DependentBlockDB { getDependentBlockDB :: LDB.DB }

-- totalDifficulty always includes the difficulty of the block currently being operated on
data DependentBlockEntry
  = DependentBlocks {blocks :: [SequencedBlock]}
  | Emitted -- , qq :: Keccak256}
  | ChildFailedConsensus
      { blocks :: [SequencedBlock]
      }
  deriving (Eq, Show, GHCG.Generic)

instance Binary DependentBlockEntry

lookupDependentBlockDB :: (MonadIO m, Accessible DependentBlockDB m) =>
                          Keccak256 -> m (Maybe DependentBlockEntry)
lookupDependentBlockDB k = do
  db <- getDependentBlockDB <$> access (Proxy @DependentBlockDB)
  fmap (fmap (decode . B.fromStrict)) $ LDB.get db LDB.defaultReadOptions (B.toStrict $ encode k)

insertDependentBlockDB :: (MonadIO m, Accessible DependentBlockDB m) =>
                          Keccak256 -> DependentBlockEntry -> m ()
insertDependentBlockDB k v = do
  db <- getDependentBlockDB <$> access (Proxy @DependentBlockDB)
  LDB.put db LDB.defaultWriteOptions (B.toStrict $ encode k) (B.toStrict $ encode v)

deleteDependentBlockDB :: (MonadIO m, Accessible DependentBlockDB m) =>
                          Keccak256 -> m ()
deleteDependentBlockDB k = do
  db <- getDependentBlockDB <$> access (Proxy @DependentBlockDB)
  LDB.delete db LDB.defaultWriteOptions (B.toStrict $ encode k)

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

-- | Run an action that only needs 'DependentBlockDB' access.
--
-- This opens a LevelDB database at the given path and provides the minimal
-- monad needed to run operations like 'bootstrapGenesisBlock'.
runWithDependentBlockDB ::
  FilePath ->  -- ^ Path to the LevelDB database
  Int ->       -- ^ Cache size (0 = 8MB default)
  ReaderT DependentBlockDB IO a ->
  IO a
runWithDependentBlockDB dbPath cacheSize action = runResourceT $ do
  db <- LDB.open dbPath LDB.defaultOptions {LDB.createIfMissing = True, LDB.cacheSize = cacheSize}
  liftIO $ runReaderT action (DependentBlockDB db)
