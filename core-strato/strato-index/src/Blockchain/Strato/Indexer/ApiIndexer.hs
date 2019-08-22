{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE TemplateHaskell   #-}
module Blockchain.Strato.Indexer.ApiIndexer
    ( apiIndexer
    , kafkaClientIds
    ) where

import           Control.Arrow                      ((&&&))
import           Control.Concurrent.MVar
import           Control.Monad
import           Control.Monad.IO.Class             (liftIO)
import           Control.Monad.Trans.Class          (lift)
import           Blockchain.Output
import qualified Data.ByteString.Char8              as S8
import           Data.List                          hiding (group)
import qualified Data.Text                          as T
import           Network.Kafka
import           Blockchain.MilenaTools
import           Network.Kafka.Protocol
import           System.Clock

import           Blockchain.Data.BlockDB
import           Blockchain.Data.DataDefs
import           Blockchain.Data.ChainInfoDB        (putChainInfo)
import           Blockchain.Data.Transaction         (insertTX)
import           Blockchain.DBM
import           Blockchain.DB.SQLDB
import           Blockchain.EthConf                 (lookupConsumerGroup)
import           Blockchain.Sequencer.Event         (filterAnchoredTxs)
import           Blockchain.Strato.Indexer.IContext
import           Blockchain.Strato.Indexer.Kafka
import           Blockchain.Strato.Indexer.Model

import           Blockchain.Sequencer.Event

import           Data.Ord
import           Database.Persist.Sql

apiIndexer :: LoggingT IO ()
apiIndexer =  runIContextM "strato-api-indexer" $ do
    oldBestBlock <- liftIO $ newEmptyMVar
    forever $ do
        $logInfoS "apiIndexer" "About to fetch blocks"
        (offset, idxEvents, bbi) <- getUnprocessedIndexEvents
        startTime <- liftIO $ getTime Realtime
        putIndexerBestBlockInfo bbi
        putIndexerBestBlockInfoTime <- liftIO $ getTime Realtime
        $logInfoS "apiIndexer" . T.pack $ "Fetched " ++ show (length idxEvents) ++ " events starting from " ++ show offset
        let txs = [tx | IndexTransaction _ tx <- idxEvents]
        lift $ forM_ txs $ \OutputTx{..} -> insertTX Log otOrigin Nothing [otBaseTx]
        let chainInfos = [(cId, cInfo) | NewChainInfo cId cInfo <- idxEvents]
        lift $ forM_ chainInfos . uncurry $ putChainInfo
        let blocks = [b | RanBlock b <- idxEvents]
        blocksTime <- liftIO $ getTime Realtime
        let nums = map (blockDataNumber . obBlockData) blocks
            nextOffset' = offset + fromIntegral (length idxEvents)
            insertCount = length blocks
        $logInfoS "apiIndexer" . T.pack $ show insertCount ++ " of them are blocks"
        (icTimes, icMsgs) <- if (insertCount > 0)
        then do
            insertStartTime <- liftIO $ getTime Realtime
            $logInfoS "apiIndexer" . T.pack $ "  (inserting " ++ show insertCount ++ " output blocks)"
            bids <- lift $ putBlocks ((outputBlockToBlock &&& obTotalDifficulty) . filterAnchoredTxs <$> blocks) False
            resultsTime <- liftIO $ getTime Realtime
            IndexerBestBlockInfo bestBid <- getIndexerBestBlockInfo
            bestBidTime <- liftIO $ getTime Realtime
            maybeOldBestBlock <- liftIO $ tryTakeMVar oldBestBlock
            num <- case maybeOldBestBlock of
                Just x -> return x
                Nothing -> fmap blockDataRefNumber . lift . sqlQuery . getJust $ bestBid
            --num <- blockDataNumber . blockBlockData <$> sqlQuery (getJust bestBid)
            numTime <- liftIO $ getTime Realtime
            let (num', bid) = maximumBy (comparing fst) $ zip nums bids
            zipTime <- liftIO $ getTime Realtime
            $logInfoS "apiIndexer" . T.pack $ "Old number: " ++ show num ++ " New Number: " ++ show num'
            if (num' > num || num' == 0) then do
                liftIO $ putMVar oldBestBlock num'
                putIndexerBestBlockInfo (IndexerBestBlockInfo bid)
            else liftIO $ putMVar oldBestBlock num
            putTime <- liftIO $ getTime Realtime
            $logInfoS "apiIndexer" . T.pack $ "put blocks into Postgres: " ++ show (resultsTime - insertStartTime)
            $logInfoS "apiIndexer" . T.pack $ "get IndexerBestBlockInfo: " ++ show (bestBidTime - resultsTime)
            $logInfoS "apiIndexer" . T.pack $ "query for best bid:       " ++ show (numTime - bestBidTime)
            $logInfoS "apiIndexer" . T.pack $ "get new best bid:         " ++ show (zipTime - numTime)
            $logInfoS "apiIndexer" . T.pack $ "put new best bid:         " ++ show (putTime - zipTime)
            return ([
                    resultsTime - insertStartTime
                    , bestBidTime - resultsTime
                    , numTime - bestBidTime
                    , zipTime - numTime
                    , putTime - zipTime
                    ]
                ,[
                    "put blocks into Postgres: "
                    , "get IndexerBestBlockInfo: "
                    , "query for best bid:       "
                    , "get new best bid:         "
                    , "put new best bid:         "
                    ])
        else return ([],[])
        startKafkaTime <- liftIO $ getTime Realtime
        setKafkaCheckpoint nextOffset' =<< getIndexerBestBlockInfo
        stopKafkaTime <- liftIO $ getTime Realtime
        let times = map toNanoSecs $
                    ([ putIndexerBestBlockInfoTime - startTime
                    , blocksTime - putIndexerBestBlockInfoTime
                    ] ++ icTimes ++ [stopKafkaTime - startKafkaTime])
            tags = [ "put IndexerBestBlockInfo: "
                , "get RanBlocks:            "
                ] ++ icMsgs ++ ["insert to Kafka:          "]
        $logDebug "----- apiIndexer -----"
        $logDebug . T.pack . unlines $ zipWith (\s t -> "Time to " ++ s ++ n2s t) tags times

n2s :: Integer -> String
n2s i =
  let s = show i
      l = length s
  in if l <= 9
       then "0." ++ (replicate (9-l) '0') ++ s ++ " seconds"
       else take (l-9) s ++ "." ++ drop (l-9) s ++ " seconds"


kafkaClientIds :: (KafkaClientId, ConsumerGroup)
kafkaClientIds = ("strato-api-indexer", lookupConsumerGroup "strato-api-indexer")

getKafkaCheckpoint :: IContextM (Offset, IndexerBestBlockInfo)
getKafkaCheckpoint = withKafkaRetry1s (fetchSingleOffset (snd kafkaClientIds) targetTopicName 0) >>= \case
    Left UnknownTopicOrPartition -> error "ApiIndexerBestBlock was never initialized in strato-setup!"
    Left err -> error $ "Unexpected response when fetching offset for " ++ show targetTopicName ++ ": " ++ show err
    Right (ofs, Metadata (KString md'))  -> return (ofs, reIBBI . read $ S8.unpack md')

setKafkaCheckpoint :: Offset -> IndexerBestBlockInfo -> IContextM ()
setKafkaCheckpoint ofs md = do
    $logInfoS "setKafkaCheckpoint" . T.pack $ "Setting checkpoint to " ++ show ofs ++ " / " ++ show md
    op <- withKafkaViolently (setKafkaCheckpoint' ofs md)
    case op of
        Left err -> error $ "Client error: " ++ show err
        Right _  -> return ()

setKafkaCheckpoint' :: (Kafka k) => Offset -> IndexerBestBlockInfo -> k (Either KafkaError ())
setKafkaCheckpoint' ofs md =
    let group     = snd kafkaClientIds
        bestBlock = Metadata . KString . S8.pack . show $ unIBBI md
    in
        commitSingleOffset group targetTopicName 0 ofs bestBlock

getUnprocessedIndexEvents :: IContextM (Offset, [IndexEvent], IndexerBestBlockInfo)
getUnprocessedIndexEvents = do
    (ofs, md) <- getKafkaCheckpoint
    evs       <- withKafkaRetry1s (readIndexEvents ofs)
    return (ofs, evs, md)
