{-# LANGUAGE BangPatterns        #-}
{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE FlexibleInstances   #-}
{-# LANGUAGE LambdaCase          #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}

module Executable.StratoAdit (
  stratoAdit
) where

import           Control.Concurrent.Lifted      hiding (yield, takeMVar, putMVar, newEmptyMVar)
import           Control.Concurrent.MVar
import           Control.Concurrent.STM
import           Control.Monad
import           Control.Monad.Logger
import           Control.Monad.State
import qualified Data.Text                      as T
import           Network.Kafka
import           Network.Kafka.Protocol
import           Prelude                        hiding (lookup)
import           System.CPUTime
import           Text.PrettyPrint.ANSI.Leijen   hiding ((<$>))

import           Blockchain.Data.BlockDB
import           Blockchain.Data.DataDefs       ()
import qualified Blockchain.Data.TXOrigin       as TO
import           Blockchain.Format
import           Blockchain.KafkaTopics
import           Blockchain.Mining
import           Blockchain.Mining.Instant
import           Blockchain.Mining.Normal
import           Blockchain.Mining.Options
import           Blockchain.Mining.SHA
import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Kafka
import           Blockchain.Stream.Raw          (setDefaultKafkaState)
import           Blockchain.Stream.UnminedBlock
import           Blockchain.Strato.Discovery.Data.Peer
import           Executable.AditM

lookupMiner :: MinerType -> Miner
lookupMiner = \case
    Normal  -> normalMiner
    Instant -> instantMiner
    _       -> shaMiner

miners :: [(Miner, Int)]
miners = take flags_threads miners'
    where miners' = zip (repeat miner') [1..]
          miner'  = lookupMiner flags_aMiner

toLog :: T.Text -> Int -> String -> AditM ()
toLog src minerNum = $logInfoS src . T.pack . show . color minerNum . text
    where
        color i = colors !! (i `mod` length colors)
        colors = [red, green, blue, yellow]

doBlock :: Int -> Block -> Integer -> AditM ()
doBlock minerNumber n newNonce = do
    let theblockData = (blockBlockData n){blockDataNonce = fromIntegral newNonce}
        theMinedBlock = n{blockBlockData = theblockData}
        coinbase = format . blockDataCoinbase . blockBlockData $ n
        theHash = blockHash theMinedBlock
    toLog "doBlock" minerNumber $ "Coinbase " ++ coinbase ++ " success for " ++ format (blockHash n) ++ " -> " ++ show newNonce
    toLog "doBlock" minerNumber $ "New block hash is " ++ format theHash ++ "!"
        -- TODO update hash too!
        -- this used to happen through setting the matching blockDataRefHash to blockHash $ theMinedBlock
    _ <- withKafkaViolently $ writeUnseqEvents [IEBlock $ blockToIngestBlock TO.Quarry theMinedBlock]
    return ()

mineBlock :: TMVar Block -> Integer -> Integer -> (Miner, Int) -> AditM ()
mineBlock mv t i (m@Miner{miner = theMiner}, mi) =
    mineNewBlock =<< liftIO (atomically $ readTMVar mv)
  where
    mineNewBlock b = do
      liftIO (theMiner b) >>= maybe (return ()) (miningSuccess b)
      mineBlock mv t (i + 1) (m,mi)
    miningSuccess b nonce = do
      !now <- liftIO getCPUTime
      toLog "mineBlock/success" mi $ "Mining success after passes: " ++ show i ++ " for miner " ++ show mi ++ " with " ++ show ( 10^ (12 :: Integer) * i `div` (1 + now - t)) ++ " hash/s "
      doBlock mi b nonce
      liftIO . atomically $ do
        nextBlock <- takeTMVar mv
        when (nextBlock /= b) $ putTMVar mv nextBlock
      !nnnow <- liftIO getCPUTime
      mineBlock mv nnnow 0 (m,mi)

doConsume :: Offset -> TMVar Block -> MVar Integer -> AditM ()
doConsume offset c lastBlkNumber = do
    $logInfoS "doConsume" . T.pack $ "Starting fetching blocks " ++ show offset
    blocks <- withKafkaViolently $ setDefaultKafkaState >> fetchUnminedBlocks offset
    numPeers <- liftIO $ getActivePeers >>= return . length
    
    forM_ blocks $ \b -> do
        lastNumber <- liftIO $ takeMVar lastBlkNumber
        let currentNumber = blockDataNumber $ blockBlockData b
        if flags_useSyncMode
        then
            if numPeers < flags_minQuorumSize
            then $logInfoS "doConsume" . T.pack $ "Not mining because # of client peers " ++ (show numPeers) ++ " is less than min quorum size (" ++ show flags_minQuorumSize ++ ")"
            else doMineThingy b
        -- ignore this block if this number has already been processed
        -- Only when running in single node instance
        else case currentNumber > lastNumber of
            True -> do 
                        doMineThingy b
                        liftIO $ putMVar lastBlkNumber currentNumber
            False -> liftIO $ putMVar lastBlkNumber lastNumber  
    doConsume (offset + fromIntegral (length blocks)) c lastBlkNumber
    where doMineThingy b = do
            liftIO . atomically $ tryTakeTMVar c >> putTMVar c b
            $logInfoS "doConsume" . T.pack $ "putTMVar w/ block #" ++ (show . blockDataNumber $ blockBlockData b)

stratoAdit :: LoggingT IO ()
stratoAdit = runAditT $ do
    $logInfoS "stratoAdit" "Starting adit"
    $logInfoS "stratoAdit" "Before STM op in mining loop"

    c <- liftIO $ atomically newEmptyTMVar
    lastBlockNumber <- liftIO $ newEmptyMVar
    liftIO $ putMVar lastBlockNumber 0

    $logInfoS "stratoAdit" . T.pack $ "Dispatching " ++ show (length miners) ++ " miners"

    !nnow <- liftIO getCPUTime
    mapM_ (fork . mineBlock c nnow 0) miners

    $logInfoS "stratoAdit" "Initing runKafka"
    $logInfoS "stratoAdit" "Will fetch offsets"

    offset <- withKafkaViolently $ getLastOffset LatestTime 0 (lookupTopic "unminedblock")
    $logInfoS "stratoAdit" . T.pack $ "Will mine starting at " ++ show offset

    doConsume (max (offset - 1) 0) c lastBlockNumber
