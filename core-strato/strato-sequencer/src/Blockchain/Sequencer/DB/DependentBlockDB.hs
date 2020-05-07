{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TypeOperators         #-}
module Blockchain.Sequencer.DB.DependentBlockDB where

import           Control.Monad                (join)
import           Control.Monad.Change.Alter
import           Control.Monad.IO.Class
import           Data.Binary

import qualified Data.ByteString.Lazy         as B
import qualified Database.LevelDB             as LDB
import qualified GHC.Generics                 as GHCG
import           Prelude                      hiding (lookup)

import           Blockchain.Data.DataDefs
import           Blockchain.Output
import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Model.SHA

type DependentBlockDB = LDB.DB

-- totalDifficulty always includes the difficulty of the block currently being operated on
data DependentBlockEntry = DependentBlocks { blocks :: [SequencedBlock] }
                         | Emitted { emittedTotalDifficulty :: Integer }
                         deriving (Eq, Read, Show, GHCG.Generic)

instance Binary DependentBlockEntry where

data EmissionReadiness = NotReadyToEmit | ReadyToEmit { totalDifficulty :: Integer }

class (MonadLogger m, MonadIO m) => HasDependentBlockDB m where
    getDependentBlockDB :: m DependentBlockDB
    getWriteOptions     :: m LDB.WriteOptions
    getReadOptions      :: m LDB.ReadOptions

    applyLDBBatchWrites :: [LDB.BatchOp] -> m ()
    applyLDBBatchWrites ops = do
        db           <- getDependentBlockDB
        writeOptions <- getWriteOptions
        LDB.write db writeOptions ops

genericLookupDependentBlockDB :: (HasDependentBlockDB m, Binary k, Binary a) => k -> m (Maybe a)
genericLookupDependentBlockDB k = do
  db          <- getDependentBlockDB
  readOptions <- getReadOptions
  fmap (decode . B.fromStrict) <$> LDB.get db readOptions (B.toStrict $ encode k)

genericInsertDependentBlockDB :: (HasDependentBlockDB m, Binary k, Binary a) => k -> a -> m ()
genericInsertDependentBlockDB k a = do
  db           <- getDependentBlockDB
  writeOptions <- getWriteOptions
  LDB.put db writeOptions (B.toStrict $ encode k) (B.toStrict $ encode a)

genericBatchInsertDependentBlockDB :: (Binary k, Binary a) => k -> a -> LDB.BatchOp
genericBatchInsertDependentBlockDB k a = LDB.Put (B.toStrict $ encode k) (B.toStrict $ encode a)

genericDeleteDependentBlockDB :: (HasDependentBlockDB m, Binary k) => k -> m ()
genericDeleteDependentBlockDB k = do
  db           <- getDependentBlockDB
  writeOptions <- getWriteOptions
  LDB.delete db writeOptions (B.toStrict $ encode k)

genericBatchDeleteDependentBlockDB :: Binary k => k -> LDB.BatchOp
genericBatchDeleteDependentBlockDB k = LDB.Del (B.toStrict $ encode k)

bootstrapGenesisBlock :: (SHA `Alters` DependentBlockEntry) m => SHA -> Integer -> m ()
bootstrapGenesisBlock hash' = insert Proxy hash' . Emitted

appendDependentBlock :: (SHA `Alters` DependentBlockEntry) m => SequencedBlock -> m ()
appendDependentBlock b = --do
  let parentHash = blockDataParentHash $ sbBlockData b
   in lookup Proxy parentHash >>= \case
        Just (Emitted _) -> return ()
        Just (DependentBlocks existingDeps) | b `elem` existingDeps -> return ()
        Nothing -> insert Proxy parentHash $ DependentBlocks [b]
        Just (DependentBlocks existingDeps) ->
          insert Proxy parentHash $ DependentBlocks (b : existingDeps)

existingParent :: (SHA `Alters` DependentBlockEntry) m => SequencedBlock -> m (Maybe DependentBlockEntry)
existingParent = lookup Proxy . blockDataParentHash . sbBlockData

readyToEmit :: (SHA `Alters` DependentBlockEntry) m => SequencedBlock -> m Bool
readyToEmit b = do
  ep <- existingParent b
  case ep of
    Just (Emitted _) -> return True
    _ -> return False

enqueueIfParentNotEmitted :: (SHA `Alters` DependentBlockEntry) m => SequencedBlock -> m EmissionReadiness
enqueueIfParentNotEmitted b = existingParent b >>= \case
  Just (Emitted totalDifficulty') ->
      return $ ReadyToEmit totalDifficulty'
  Just (DependentBlocks existingDeps) | b `elem` existingDeps -> return NotReadyToEmit -- case of duplicate seen
  Just (DependentBlocks existingDeps) -> do
    insert Proxy (blockDataParentHash $ sbBlockData b) $ DependentBlocks (b:existingDeps)
    return NotReadyToEmit
  Nothing -> do
    insert Proxy (blockDataParentHash $ sbBlockData b) $ DependentBlocks [b]
    return NotReadyToEmit

insertEmitted :: (SHA `Alters` DependentBlockEntry) m => SequencedBlock -> m (Maybe OutputBlock)
insertEmitted b = existingParent b >>= \case
  Just (Emitted t) -> do
    insert Proxy (sbHash b) . Emitted $ totalDifficulty' t
    return . Just $ theBlock t
  _ -> return Nothing
  where totalDifficulty' t = t + sequencedBlockDifficulty b
        theBlock t = sequencedBlockToOutputBlock b $ totalDifficulty' t

buildEmissionChain :: (SHA `Alters` DependentBlockEntry) m
                   => SequencedBlock
                   -> Integer
                   -> m [OutputBlock]
buildEmissionChain b lastTotalDifficulty = lookup Proxy (sbHash b) >>= \case
  Nothing -> do
    insert Proxy (sbHash b) $ Emitted totalDifficulty'
    return [theBlock]
  Just (Emitted _) -> return []
  Just (DependentBlocks blocks') -> do
    insert Proxy (sbHash b) $ Emitted totalDifficulty'
    subChains <- sequence $ flip buildEmissionChain totalDifficulty' <$> blocks'
    return $ theBlock : join subChains
  where totalDifficulty' = lastTotalDifficulty + sequencedBlockDifficulty b
        theBlock = sequencedBlockToOutputBlock b totalDifficulty'
