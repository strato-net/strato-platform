{-# LANGUAGE FlexibleContexts,FlexibleInstances, OverloadedStrings, TemplateHaskell, ScopedTypeVariables, BangPatterns, LambdaCase #-}

module Executable.StratoAdit (
  stratoAdit
) where

import Control.Concurrent.Lifted
import Control.Concurrent.STM
import Control.Monad
import Control.Monad.Logger
import Control.Monad.State
import Control.Monad.Trans.Resource
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

import Blockchain.Stream.Raw (setDefaultKafkaState)

import Blockchain.Mining.Options

import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import qualified Blockchain.Data.TXOrigin as TO

import Executable.AditM
import Executable.SQLMonad

lookupMiner :: MinerType -> Miner
lookupMiner = \case
    Normal  -> normalMiner
    Instant -> instantMiner
    _       -> shaMiner

miners :: [(Miner, Int)]
miners = take flags_threads miners
    where miners = zip (repeat miner) [1..]
          miner  = lookupMiner flags_aMiner

toLog :: T.Text -> Int -> String -> AditM ()
toLog src minerNum = $logInfoS src . T.pack . show . color minerNum . text
    where
        color i = colors !! (i `mod` length colors)
        colors = [red, green, blue, yellow]

doBlock :: Int -> Block -> Integer -> AditM ()
doBlock minerNumber n newNonce = do
    toLog "doBlock" minerNumber $ "Miner success for " ++ format (blockHash n) ++ " -> " ++ show newNonce ++ "!" --(format $ n)
    let theblockData = (blockBlockData n){blockDataNonce = fromIntegral newNonce}
        theMinedBlock = n{blockBlockData = theblockData}
    let theHash = blockHash theMinedBlock
    toLog "doBlock" minerNumber $ "New block hash is " ++ format theHash ++ "!"
        -- TODO update hash too!
        -- this used to happen through setting the matching blockDataRefHash to blockHash $ theMinedBlock
    _ <- produceVMEventsM [ChainBlock theMinedBlock]
    _ <- withKafkaViolently $ writeUnseqEvents [IEBlock $ blockToIngestBlock TO.Quarry theMinedBlock]
    putNewBlk $ blockToNewBlk theMinedBlock

mineBlock :: TMVar Block -> Integer -> Integer -> (Miner, Int) -> AditM ()
mineBlock mv t i (m@Miner{miner = theMiner}, mi) =
    mineNewBlock =<< liftIO (atomically $ readTMVar mv)
  where
    mineNewBlock b = do
      liftIO (theMiner b) >>= maybe (return ()) (miningSuccess b)
      !nnow <- liftIO getCPUTime
      mineBlock mv nnow (i + 1) (m,mi)
    miningSuccess b nonce = do
      !now <- liftIO getCPUTime
      toLog "mineBlock/success" mi $ "Mining success after passes: " ++ show i ++ " for miner " ++ show mi ++ " with " ++ show (10^12 * i `div` (1 + now - t)) ++ " hash/s "
      doBlock mi b nonce
      liftIO . atomically $ do
        nextBlock <- takeTMVar mv
        when (nextBlock /= b) $ putTMVar mv nextBlock
      !nnnow <- liftIO getCPUTime
      mineBlock mv nnnow 0 (m,mi)

doConsume :: Offset -> TMVar Block -> AditM ()
doConsume offset c = do
    $logInfoS "doConsumer" . T.pack $ "Starting fetching blocks " ++ show offset
    blocks <- withKafkaViolently $ setDefaultKafkaState >> fetchUnminedBlocks offset
    forM_ blocks $ \b ->
        liftIO . atomically $ tryTakeTMVar c >> putTMVar c b
    doConsume (offset + fromIntegral (length blocks)) c

stratoAdit :: LoggingT IO ()
stratoAdit = runAditT flags_pgPoolSize $ do
    $logInfoS "stratoAdit" "Starting adit"
    $logInfoS "stratoAdit" "Before STM op in mining loop"

    c <- liftIO $ atomically newEmptyTMVar

    $logInfoS "stratoAdit" . T.pack $ "Dispatching " ++ show (length miners) ++ " miners"

    !nnow <- liftIO getCPUTime
    mapM_ (fork . mineBlock c nnow 0) miners

    $logInfoS "stratoAdit" "Initing runKafka"
    $logInfoS "stratoAdit" "Will fetch offsets"

    offset <- withKafkaViolently $ getLastOffset LatestTime 0 (lookupTopic "unminedblock")
    $logInfoS "stratoAdit" . T.pack $ "Will mine starting at " ++ show offset

    doConsume (max (offset - 1) 0) c
