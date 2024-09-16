{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Sequencer.DB.DependentBlockDB where

import BlockApps.Logging
import Blockchain.Data.BlockHeader
import Blockchain.Sequencer.Event
import Blockchain.Strato.Model.Keccak256
import Control.Monad (join)
import Control.Monad.Change.Alter
import Control.Monad.IO.Class
import Data.Binary
import qualified Data.ByteString.Lazy as B
import qualified Data.Text as T
import qualified Database.LevelDB as LDB
import qualified GHC.Generics as GHCG
import Text.Format
import Prelude hiding (lookup)

type DependentBlockDB = LDB.DB

-- totalDifficulty always includes the difficulty of the block currently being operated on
data DependentBlockEntry
  = DependentBlocks {blocks :: [SequencedBlock]}
  | Emitted {emittedTotalDifficulty :: Integer}
  | ChildFailedConsensus
      { emittedTotalDifficulty :: Integer,
        blocks :: [SequencedBlock]
      }
  deriving (Eq, Show, GHCG.Generic)

instance Binary DependentBlockEntry

data EmissionReadiness = NotReadyToEmit | ReadyToEmit {totalDifficulty :: Integer}

class (MonadLogger m, MonadIO m) => HasDependentBlockDB m where
  getDependentBlockDB :: m DependentBlockDB
  getWriteOptions :: m LDB.WriteOptions
  getReadOptions :: m LDB.ReadOptions

  applyLDBBatchWrites :: [LDB.BatchOp] -> m ()
  applyLDBBatchWrites ops = do
    db <- getDependentBlockDB
    writeOptions <- getWriteOptions
    LDB.write db writeOptions ops

genericLookupDependentBlockDB :: (HasDependentBlockDB m, Binary k, Binary a) => k -> m (Maybe a)
genericLookupDependentBlockDB k = do
  db <- getDependentBlockDB
  readOptions <- getReadOptions
  fmap (decode . B.fromStrict) <$> LDB.get db readOptions (B.toStrict $ encode k)

genericInsertDependentBlockDB :: (HasDependentBlockDB m, Binary k, Binary a) => k -> a -> m ()
genericInsertDependentBlockDB k a = do
  db <- getDependentBlockDB
  writeOptions <- getWriteOptions
  LDB.put db writeOptions (B.toStrict $ encode k) (B.toStrict $ encode a)

genericBatchInsertDependentBlockDB :: (Binary k, Binary a) => k -> a -> LDB.BatchOp
genericBatchInsertDependentBlockDB k a = LDB.Put (B.toStrict $ encode k) (B.toStrict $ encode a)

genericDeleteDependentBlockDB :: (HasDependentBlockDB m, Binary k) => k -> m ()
genericDeleteDependentBlockDB k = do
  db <- getDependentBlockDB
  writeOptions <- getWriteOptions
  LDB.delete db writeOptions (B.toStrict $ encode k)

genericBatchDeleteDependentBlockDB :: Binary k => k -> LDB.BatchOp
genericBatchDeleteDependentBlockDB k = LDB.Del (B.toStrict $ encode k)

bootstrapGenesisBlock :: (Keccak256 `Alters` DependentBlockEntry) m => Keccak256 -> Integer -> m ()
bootstrapGenesisBlock hash' = insert Proxy hash' . Emitted

appendChildFailure :: (Keccak256 `Alters` DependentBlockEntry) m => SequencedBlock -> m ()
appendChildFailure b =
  --do
  let parentHash' = parentHash $ sbBlockData b
   in repsert_ Proxy parentHash' $ \case
        Just (Emitted t) -> pure $ ChildFailedConsensus t [b]
        Just (ChildFailedConsensus t bs) -> pure $ ChildFailedConsensus t (b : bs)
        _ -> error "appendChildFailure: Parent hasn't been emitted yet. This should never happen"

existingParent :: (Keccak256 `Alters` DependentBlockEntry) m => SequencedBlock -> m (Maybe DependentBlockEntry)
existingParent = lookup Proxy . parentHash . sbBlockData

readyToEmit :: (Keccak256 `Alters` DependentBlockEntry) m => SequencedBlock -> m Bool
readyToEmit b = do
  ep <- existingParent b
  case ep of
    Just (Emitted _) -> return True
    Just (ChildFailedConsensus _ existingDeps) | not (b `elem` existingDeps) -> return True
    _ -> return False

enqueueIfParentNotEmitted :: (Keccak256 `Alters` DependentBlockEntry) m => SequencedBlock -> m EmissionReadiness
enqueueIfParentNotEmitted b =
  existingParent b >>= \case
    Just (Emitted totalDifficulty') ->
      return $ ReadyToEmit totalDifficulty'
    Just (DependentBlocks existingDeps) | b `elem` existingDeps -> return NotReadyToEmit -- case of duplicate seen
    Just (DependentBlocks existingDeps) -> do
      insert Proxy (parentHash $ sbBlockData b) $ DependentBlocks (b : existingDeps)
      return NotReadyToEmit
    Just (ChildFailedConsensus _ existingDeps) | b `elem` existingDeps -> return NotReadyToEmit -- case of duplicate seen
    Just (ChildFailedConsensus totalDifficulty' _) ->
      return $ ReadyToEmit totalDifficulty'
    Nothing -> do
      insert Proxy (parentHash $ sbBlockData b) $ DependentBlocks [b]
      return NotReadyToEmit

insertEmitted :: (Keccak256 `Alters` DependentBlockEntry) m => SequencedBlock -> m (Maybe OutputBlock)
insertEmitted b =
  existingParent b >>= \case
    Just (Emitted t) -> do
      insert Proxy (sbHash b) . Emitted $ totalDifficulty' t
      return . Just $ theBlock t
    Just (ChildFailedConsensus t existingDeps) | not (b `elem` existingDeps) -> do
      insert Proxy (sbHash b) . Emitted $ totalDifficulty' t
      return . Just $ theBlock t
    _ -> return Nothing
  where
    totalDifficulty' t = t + sequencedBlockDifficulty b
    theBlock t = sequencedBlockToOutputBlock b $ totalDifficulty' t

buildEmissionChain ::
  ( (Keccak256 `Alters` DependentBlockEntry) m,
    MonadLogger m
  ) =>
  SequencedBlock ->
  Integer ->
  m [OutputBlock]
buildEmissionChain = buildEmissionChain' False

buildEmissionChain' ::
  ( (Keccak256 `Alters` DependentBlockEntry) m,
    MonadLogger m
  ) =>
  Bool ->
  SequencedBlock ->
  Integer ->
  m [OutputBlock]
buildEmissionChain' retryFailed b lastTotalDifficulty =
  lookup Proxy (sbHash b) >>= \case
    Nothing -> do
      $logDebugS "buildEmissionChain'" . T.pack $ "Got Nothing for " <> format (sbHash b)
      insert Proxy (sbHash b) $ Emitted totalDifficulty'
      return [theBlock totalDifficulty']
    Just (Emitted _) -> do
      $logDebugS "buildEmissionChain'" . T.pack $ "Got Emitted for " <> format (sbHash b)
      if retryFailed
        then return [theBlock totalDifficulty']
        else return []
    Just (DependentBlocks blocks') -> do
      $logDebugS "buildEmissionChain'" . T.pack $ "Got DependentBlocks for " <> format (sbHash b)
      insert Proxy (sbHash b) $ Emitted totalDifficulty'
      subChains <- sequence $ flip (buildEmissionChain' retryFailed) totalDifficulty' <$> blocks'
      return $ theBlock totalDifficulty' : join subChains
    Just (ChildFailedConsensus t blocks') -> do
      $logDebugS "buildEmissionChain'" . T.pack $ "Got ChildFailedConsensus for " <> format (sbHash b)
      $logDebugS "buildEmissionChain'" . T.pack $ "retryFailed is " <> show retryFailed
      if retryFailed
        then do
          insert Proxy (sbHash b) $ Emitted t
          subChains <- sequence $ flip (buildEmissionChain' retryFailed) t <$> blocks'
          return $ theBlock t : join subChains
        else return []
  where
    totalDifficulty' = lastTotalDifficulty + sequencedBlockDifficulty b
    theBlock t' = sequencedBlockToOutputBlock b t'

retryFailedChildren ::
  ( (Keccak256 `Alters` DependentBlockEntry) m,
    MonadLogger m
  ) =>
  Keccak256 ->
  m [OutputBlock]
retryFailedChildren h =
  lookup Proxy h >>= \case
    Just (ChildFailedConsensus t blocks') -> do
      $logInfoS "retryFailedChildren" . T.pack $ "Block " <> format h <> " has " <> show (length blocks') <> " failed children."
      insert Proxy h $ Emitted t
      fmap join . sequence $ flip (buildEmissionChain' True) t <$> blocks'
    _ -> return []
