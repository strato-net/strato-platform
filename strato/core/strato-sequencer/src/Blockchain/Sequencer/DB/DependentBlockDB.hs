{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Sequencer.DB.DependentBlockDB (
  DependentBlockDB(..),
  DependentBlockEntry,
  EmissionReadiness(..),
  bootstrapGenesisBlock,
  lookupDependentBlockDB,
  insertDependentBlockDB,
  deleteDependentBlockDB,
  insertEmitted,
  enqueueIfParentNotEmitted,
  buildEmissionChain
  ) where

import BlockApps.Logging
import Blockchain.Data.BlockHeader
import Blockchain.Model.WrappedBlock
import Blockchain.Strato.Model.Keccak256
import Control.Monad (join)
import Control.Monad.Change.Alter
import Control.Monad.Change.Modify
import Control.Monad.IO.Class
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

data EmissionReadiness = NotReadyToEmit | ReadyToEmit

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

enqueueIfParentNotEmitted :: (Keccak256 `Alters` DependentBlockEntry) m => SequencedBlock -> m EmissionReadiness
enqueueIfParentNotEmitted b =
  existingParent b >>= \case
    Just Emitted ->
      return ReadyToEmit
    Just (DependentBlocks existingDeps) | b `elem` existingDeps -> return NotReadyToEmit -- case of duplicate seen
    Just (DependentBlocks existingDeps) -> do
      insert Proxy (parentHash $ sbBlockData b) $ DependentBlocks (b : existingDeps)
      return NotReadyToEmit
    Just (ChildFailedConsensus existingDeps) | b `elem` existingDeps -> return NotReadyToEmit -- case of duplicate seen
    Just (ChildFailedConsensus _) ->
      return ReadyToEmit
    Nothing -> do
      insert Proxy (parentHash $ sbBlockData b) $ DependentBlocks [b]
      return NotReadyToEmit

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

buildEmissionChain ::
  ( (Keccak256 `Alters` DependentBlockEntry) m,
    MonadLogger m
  ) =>
  SequencedBlock -> m [OutputBlock]
buildEmissionChain b =
  lookup Proxy (sbHash b) >>= \case
    Nothing -> do
      $logDebugS "buildEmissionChain" . T.pack $ "Got Nothing for " <> format (sbHash b)
      insert Proxy (sbHash b) $ Emitted
      return [theBlock]
    Just Emitted -> do
      $logDebugS "buildEmissionChain" . T.pack $ "Got Emitted for " <> format (sbHash b)
      return []
    Just (DependentBlocks blocks') -> do
      $logDebugS "buildEmissionChain" . T.pack $ "Got DependentBlocks for " <> format (sbHash b)
      insert Proxy (sbHash b) $ Emitted
      subChains <- sequence $ buildEmissionChain <$> blocks'
      return $ theBlock : join subChains
    Just (ChildFailedConsensus _) -> do
      $logDebugS "buildEmissionChain" . T.pack $ "Got ChildFailedConsensus for " <> format (sbHash b)
      return []
  where
    theBlock = sequencedBlockToOutputBlock b
