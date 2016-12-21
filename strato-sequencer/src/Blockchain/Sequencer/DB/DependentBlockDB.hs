{-# LANGUAGE DeriveGeneric, TemplateHaskell, OverloadedStrings #-}
module Blockchain.Sequencer.DB.DependentBlockDB where

import Control.Monad (join)
import Data.Binary
import Data.Text (pack)

import Control.Monad.Logger
import Control.Monad.Trans.Resource

import qualified Blockchain.Data.DataDefs as DD
import qualified Database.LevelDB as LDB
import qualified GHC.Generics as GHCG

import qualified Data.ByteString.Lazy as B
import qualified Data.ByteString      as BS

import Blockchain.SHA
import Blockchain.Sequencer.Event

type DependentBlockDB = LDB.DB

-- totalDifficulty always includes the difficulty of the block currently being operated on
data DependentBlockEntry = DependentBlocks { blocks :: [SequencedBlock] }
                         | Emitted { emittedTotalDifficulty :: Integer }
                         deriving (Eq, Read, Show, GHCG.Generic)

instance Binary DependentBlockEntry where

data EmissionReadiness = NotReadyToEmit | ReadyToEmit { totalDifficulty :: Integer }

class (MonadLogger m, MonadResource m) => HasDependentBlockDB m where
    getDependentBlockDB :: m DependentBlockDB
    getWriteOptions     :: m LDB.WriteOptions
    getReadOptions      :: m LDB.ReadOptions

    applyLDBBatchWrites :: [LDB.BatchOp] -> m ()
    applyLDBBatchWrites ops = do
        db           <- getDependentBlockDB
        writeOptions <- getWriteOptions
        LDB.write db writeOptions ops

    bootstrapGenesisBlock :: SHA -> Integer -> m ()
    bootstrapGenesisBlock hash difficulty = do
        db           <- getDependentBlockDB
        writeOptions <- getWriteOptions
        encodedHash  <- return . B.toStrict . encode $ hash
        encodedEmit  <- return . B.toStrict . encode $ Emitted difficulty
        LDB.put db writeOptions encodedHash encodedEmit

    appendDependentBlock :: SequencedBlock -> m ()
    appendDependentBlock b = do
        db                  <- getDependentBlockDB
        readOptions         <- getReadOptions
        writeOptions        <- getWriteOptions
        parentHash          <- return $ parentHashBS b
        maybeExistingParent <- LDB.get db readOptions parentHash
        case (decode . B.fromStrict) <$> maybeExistingParent of -- if emitted or already queued, nothing to do
            Just (Emitted _) -> return ()
            Just (DependentBlocks existingDeps) | b `elem` existingDeps -> return ()
            Nothing ->
                LDB.put db writeOptions parentHash $ B.toStrict . encode $ DependentBlocks [b]
            Just (DependentBlocks existingDeps) ->
                LDB.put db writeOptions parentHash $ B.toStrict . encode $ DependentBlocks (b:existingDeps)

    enqueueIfParentNotEmitted :: SequencedBlock -> m EmissionReadiness
    enqueueIfParentNotEmitted b = do
--         (logInfo) . pack $ "enqueueIfParentNotEmitted :: " ++ sequencedBlockShortName b
        db                  <- getDependentBlockDB
        readOptions         <- getReadOptions
        writeOptions        <- getWriteOptions
        parentHash          <- return $ parentHashBS b
        maybeExistingParent <- LDB.get db readOptions parentHash
        case (decode . B.fromStrict) <$> maybeExistingParent of
            Just (Emitted totalDifficulty) ->
                return $ ReadyToEmit totalDifficulty
            Just (DependentBlocks existingDeps) | b `elem` existingDeps -> return NotReadyToEmit -- case of duplicate seen
            Just (DependentBlocks existingDeps) -> do
                LDB.put db writeOptions parentHash $ B.toStrict . encode $ DependentBlocks (b:existingDeps)
                return NotReadyToEmit
            Nothing -> do
                LDB.put db writeOptions parentHash $ B.toStrict . encode $ DependentBlocks [b]
                return NotReadyToEmit

    buildEmissionChain :: SequencedBlock -> Integer -> m [(Maybe LDB.BatchOp, OutputEvent)]
    buildEmissionChain b lastTotalDifficulty = do
--         (logInfo) . pack $ "buildEmissionChain :: " ++ sequencedBlockShortName b ++ " // " ++ (show lastTotalDifficulty)
        db           <- getDependentBlockDB
        readOptions  <- getReadOptions
        children     <- LDB.get db readOptions thisBlockHash
        case (decode . B.fromStrict) <$> children of
            Nothing -> return $ [theRet]
            Just (Emitted _) -> return [] -- we already emitted this hash somehow? wtf???
            Just (DependentBlocks blocks) -> do
                subChains <- sequence $ ((flip buildEmissionChain) totalDifficulty) <$> blocks
                return $ theRet : (join subChains)
        where
            thisBlockHash   = blockHashBS b
            totalDifficulty = lastTotalDifficulty + (sequencedBlockDifficulty b)
            thePutOperation = Just $ (LDB.Put thisBlockHash) . (B.toStrict . encode) $ Emitted totalDifficulty
            theBlock        = sequencedBlockToOutputBlock b totalDifficulty
            theRet          = (thePutOperation, OEBlock theBlock)
