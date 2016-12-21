{-# LANGUAGE FlexibleContexts,FlexibleInstances, OverloadedStrings, TemplateHaskell, ScopedTypeVariables, BangPatterns #-}
{-# OPTIONS_GHC -fno-warn-missing-signatures #-}

module Executable.StratoAdit (
  stratoAdit
  ) where

import Control.Concurrent.Lifted
import Control.Concurrent.STM
import Control.Monad
import Control.Monad.Logger
import Control.Monad.Trans.Class
import Data.Maybe
import qualified Data.Text as T
import Control.Monad.IO.Class
import Text.PrettyPrint.ANSI.Leijen hiding ((<$>))
import System.IO.Unsafe
import System.CPUTime

import Blockchain.Mining
import Blockchain.Mining.SHA
import Blockchain.Mining.Normal
import Blockchain.Mining.Instant

import Blockchain.Stream.UnminedBlock
import Blockchain.Stream.VMEvent

import Network.Kafka
import Network.Kafka.Protocol

import Blockchain.Format

import Blockchain.Data.BlockDB
import Blockchain.Data.NewBlk
import Blockchain.DB.SQLDB
import Blockchain.Data.DataDefs()
import Blockchain.EthConf
import Blockchain.KafkaTopics

import Blockchain.Quarry.SQL.Conn

import Blockchain.Mining.Options

import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import qualified Blockchain.Data.TXOrigin as TO

miners :: [(Miner, Int)]
miners = take flags_threads mis
    where
  mis = zip (repeat min) [1..]
  min = if (flags_aMiner == Normal) then normalMiner else if (flags_aMiner == Instant) then instantMiner else shaMiner

toLog i m = logInfoN $ T.pack $ show $ colors!!(i `mod` (length colors)) $ text $ m
   where
     colors = [red, green, blue, yellow]

doBlock :: (HasSQLDB m, MonadLogger m) => Block -> Integer -> m ()
doBlock n newNonce = do
    toLog 0 $ "Miner success for " ++ (format $ blockHash n) ++ " -> " ++ (show newNonce) ++ "!\n" --(format $ n)
    let theblockData = (blockBlockData n){blockDataNonce = fromIntegral newNonce}
        theMinedBlock = n{blockBlockData = theblockData}
    let theHash = blockHash $ theMinedBlock
    toLog 0 $ "New block hash is " ++ (format $ theHash) ++ "!\n" 
        -- TODO update hash too!
        -- this used to happen through setting the matching blockDataRefHash to blockHash $ theMinedBlock
    _ <- produceVMEvents [ChainBlock theMinedBlock]
    _ <- liftIO $ runKafkaConfigured "strato-adit" $ writeUnseqEvents [(IEBlock $ blockToIngestBlock TO.Quarry theMinedBlock)]
    putNewBlk $ blockToNewBlk theMinedBlock
    return ()

mineBlock :: (HasSQLDB  m, MonadLogger m) => TMVar (Block) -> Integer -> Integer -> (Miner, Int) -> m ()
mineBlock mv t i (m@Miner{miner = theMiner}, mi) = 
  do
    b <- (liftIO $ atomically $ readTMVar mv) 
    mineNewBlock b
  where
    mineNewBlock b = do
      liftIO (theMiner b) >>= maybe (return ()) (miningSuccess b)
      let !nnow = (unsafePerformIO getCPUTime)  
      mineBlock mv nnow (i + 1) (m,mi)
    miningSuccess b nonce = do
      let !now = unsafePerformIO $ getCPUTime
      toLog mi $ "Mining success after passes: " ++ (show i) ++ " for miner " ++ (show mi) ++ " with " ++ (show $ 10^(12) * i `div` (1 + now - t)) ++ " hash/s " 
      doBlock b nonce 
      liftIO $ atomically $ do
        nextBlock <- takeTMVar mv 
        when (nextBlock /= b) $ do
          putTMVar mv nextBlock
      let !nnnow = (unsafePerformIO getCPUTime)
      mineBlock mv nnnow 0 (m,mi)

stratoAdit :: LoggingT IO ()
stratoAdit = do  
    logInfoN "Starting adit"
    logInfoN "Before STM op in mining loop"

    c <- liftIO $ atomically newEmptyTMVar 

    logInfoN "Dispatching miners"
    runConnT $ do
      let !nnow = (unsafePerformIO getCPUTime)
      mapM_ (fork . mineBlock c nnow 0) miners

      lift $ logInfoN "Initing runKafka"

      lift $ logInfoN "Will fetch offsets"
      
      errOrOffset <- liftIO $ runKafkaConfigured "strato-adit" $ 
                getLastOffset LatestTime 0 (lookupTopic "unminedblock")

      let offset = either (error . ("unable to get stream offset: " ++) . show) id errOrOffset
    
      doConsume  (max (offset - 1) 0) c

    where
      doConsume :: (MonadIO (t m), MonadTrans t,  MonadLogger m) =>
                   Offset -> TMVar Block -> t m ()
      doConsume offset c = do
        lift $ logInfoN "Starting fetching blocks"
        maybeBlocks <- liftIO $ fetchUnminedBlocksIO offset

        let blocks = fromMaybe (error "problem fetching blocks") maybeBlocks
        
        forM_ blocks $ \b -> do
          -- lift $ logInfoN $ T.pack $ "Block:\n" ++ format b
          liftIO $ atomically $ do
            _ <- tryTakeTMVar c
            putTMVar c b 

        doConsume (offset + fromIntegral (length blocks)) c
