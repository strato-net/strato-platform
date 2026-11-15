{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Replay (replayBlocks) where

import Blockchain.BlockStream (withBlockStream)
import Blockchain.Data.Block (blockBlockData)
import Blockchain.Data.BlockHeader (headerHash, number)
import Blockchain.Data.GenesisBlock (genesisInfoToBlock)
import Blockchain.Data.GenesisInfo (getGenesisInfo)
import qualified Blockchain.Data.TXOrigin as Origin
import Blockchain.EthConf (lookupRedisBlockDBConfig, runStreamMConfigured)
import Blockchain.Model.SyncState (bestSequencedBlockNumber, bestSequencedBlockHash)
import Blockchain.Model.WrappedBlock (blockToIngestBlock)
import Blockchain.Sequencer.Event (IngestEvent (IEBlock))
import Blockchain.Sequencer.Kafka (writeUnseqEvents)
import Blockchain.SyncDB (getBestSequencedBlockInfo, updateWorldBestBlockInfo)
import Control.Concurrent (threadDelay)
import Control.Monad (replicateM, unless, void, when)
import Control.Monad.Composable.Base (runEff)
import Control.Monad.IO.Class (liftIO)
import Data.Maybe (catMaybes)
import qualified Database.Redis as Redis
import System.Directory (doesPathExist, pathIsSymbolicLink)
import System.IO.Error (catchIOError, isDoesNotExistError)

replayBlocks :: IO ()
replayBlocks = do
  exists <- doesPathExist "replay.blocks"
  linked <- catchIOError (pathIsSymbolicLink "replay.blocks") $ \err ->
    if isDoesNotExistError err then pure False else ioError err
  when (exists || linked) $ withBlockStream "replay.blocks" $ \end next -> do
    genesis <- next >>= maybe (fail "Missing replay genesis block") pure
    localGenesis <- genesisInfoToBlock <$> getGenesisInfo
    unless (headerHash (blockBlockData genesis) == headerHash (blockBlockData localGenesis)) $
      fail "Replay recording belongs to a different genesis/network"
    conn <- Redis.checkedConnect lookupRedisBlockDBConfig
    let best = maybe 0 bestSequencedBlockNumber <$> Redis.runRedis conn getBestSequencedBlockInfo
    initial <- Redis.runRedis conn getBestSequencedBlockInfo
    let start = maybe 0 bestSequencedBlockNumber initial
    putStrLn $ "Replaying recorded blocks " ++ show (start + 1) ++ ".." ++ show end
    runEff $ runStreamMConfigured "strato-p2p-replay" $ do
      let loop = do
            batch <- liftIO $ catMaybes <$> replicateM 1000 next
            unless (null batch) $ do
              liftIO $ mapM_ (\info -> mapM_ (\block ->
                unless (headerHash (blockBlockData block) == bestSequencedBlockHash info) $
                  fail "Replay recording disagrees with the existing sequenced chain")
                [block | block <- batch, number (blockBlockData block) == start]) initial
              let header = blockBlockData $ last batch
              liftIO $ Redis.runRedis conn (updateWorldBestBlockInfo (headerHash header) (number header))
                >>= either (fail . show) (const $ pure ())
              let events = [IEBlock $ blockToIngestBlock (Origin.PeerString "replay.blocks") block
                           | block <- batch, number (blockBlockData block) > start]
              unless (null events) $ void $ writeUnseqEvents events
              loop
      loop
    putStrLn $ "Recording queued; waiting for sequencer block " ++ show end
    let wait = best >>= \height -> when (height < end) $ threadDelay 1000000 >> wait
    wait
    putStrLn "Recorded blocks sequenced; starting normal P2P connections"
