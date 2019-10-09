{-# LANGUAGE BangPatterns        #-}
{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE FlexibleInstances   #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}

module Executable.StratoAdit (
  stratoAdit
) where

import           Control.Monad
import           Control.Monad.Except
import           Blockchain.Output
import           Control.Monad.State
import qualified Data.Text                      as T
import           Network.Kafka
import           Blockchain.MilenaTools
import           Network.Kafka.Protocol
import           Prelude                        hiding (lookup)
import           System.CPUTime
import           Text.PrettyPrint.ANSI.Leijen   hiding ((<$>))
import           UnliftIO.Concurrent
import           UnliftIO.STM

import           Blockchain.Data.BlockDB
import           Blockchain.Data.DataDefs       ()
import qualified Blockchain.Data.TXOrigin       as TO
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
import           Text.Format

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
        number = blockDataNumber . blockBlockData $ n
        txLength = length . blockReceiptTransactions $ n
    toLog "doBlock" minerNumber $ "Coinbase " ++ coinbase ++ " success for " ++ format (blockHash n) ++ " -> " ++ show newNonce
    toLog "doBlock" minerNumber $ "New block hash is " ++ format theHash ++ "!"
    $logDebugS "writeUnseqEventsBegin" . T.pack $ "Writing block number " ++ show number ++ " with " ++ show txLength ++ " txs to unseqevents"
        -- TODO update hash too!
        -- this used to happen through setting the matching blockDataRefHash to blockHash $ theMinedBlock
    _ <- withKafkaViolently $ writeUnseqEvents [IEBlock $ blockToIngestBlock TO.Quarry theMinedBlock]
    $logDebugS "writeUnseqEventsEnd" . T.pack $ "Wrote block number " ++ show number ++ " with " ++ show txLength ++ " txs to unseqevents"
    return ()

mineBlock :: TMVar Block -> Integer -> Integer -> (Miner, Int) -> AditM ()
mineBlock mv t i (m@Miner{miner = theMiner}, mi) =
    mineNewBlock =<< atomically (readTMVar mv)
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

doConsume :: Offset -> TMVar Block -> AditM ()
doConsume offset c = do
    $logInfoS "doConsume" . T.pack $ "Starting fetching blocks " ++ show offset
    blocks <- withKafkaViolently $ setDefaultKafkaState >> fetchUnminedBlocks offset

    ePeers <- liftIO getActivePeers
    case (length <$> ePeers, reverse blocks) of
      (Left err, _) -> do
        $logErrorS "doConsume" . T.pack $ "Could not get active peers: " ++ show err
        recordException
        doConsume offset c
      --meh, kafka just timed out or something, no blocks, no big deal
      (_, []) -> doConsume offset c
      (Right numPeers, b:_) -> do --b is the last block, because of the reverse above
        let quorumSizeCriteria = not flags_useSyncMode || numPeers >= flags_minQuorumSize

        if quorumSizeCriteria
          then do
            liftIO . atomically $ tryTakeTMVar c >> putTMVar c b
            $logInfoS "doConsume" . T.pack $ "putTMVar w/ block #"
              ++ (show . blockDataNumber $ blockBlockData b)
           else $logInfoS "doConsume" . T.pack $ "Not mining because # of client peers " ++ show numPeers
             ++ " is less than min quorum size (" ++ show flags_minQuorumSize ++ ")"

        doConsume (offset + fromIntegral (length blocks)) c

stratoAdit :: LoggingT IO ()
stratoAdit = runAditT $ do
    $logInfoS "stratoAdit" "Starting adit"
    $logInfoS "stratoAdit" "Before STM op in mining loop"

    c <- liftIO $ atomically newEmptyTMVar

    $logInfoS "stratoAdit" . T.pack $ "Dispatching " ++ show (length miners) ++ " miners"

    !nnow <- liftIO getCPUTime
    initialState <- get
    mapM_ (lift . forkIO . flip evalStateT initialState . mineBlock c nnow 0) miners

    $logInfoS "stratoAdit" "Initing runKafka"
    $logInfoS "stratoAdit" "Will fetch offsets"

    offset <- withKafkaRetry1s $ getLastOffset LatestTime 0 (lookupTopic "unminedblock")
    $logInfoS "stratoAdit" . T.pack $ "Will mine starting at " ++ show offset

    doConsume (max (offset - 1) 0) c
