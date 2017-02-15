{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

module Blockchain.Strato.Indexer.ApiIndexer
    ( apiIndexer
    , kafkaClientIds
    ) where

import           Control.Monad
import           Control.Monad.Logger
import qualified Data.ByteString.Char8              as S8
import           Data.List                          hiding (group)
import qualified Data.Text                          as T
import           Network.Kafka
import           Network.Kafka.Consumer
import           Network.Kafka.Protocol

import           Blockchain.Data.BlockDB
import           Blockchain.DB.SQLDB
import           Blockchain.EthConf (lookupConsumerGroup)
import           Blockchain.Strato.Model.SHA
import           Blockchain.Strato.Indexer.IContext
import           Blockchain.Strato.Indexer.Kafka
import           Blockchain.Strato.Indexer.Model

import           Blockchain.Sequencer.Event

import           Data.Ord
import           Database.Persist.Sql

apiIndexer :: LoggingT IO ()
apiIndexer = runIContextM "strato-api-indexer" . forever $ do
    $logInfoS "apiIndexer" "About to fetch blocks"
    (offset, idxEvents, bbi) <- getUnprocessedIndexEvents
    putIndexerBestBlockInfo bbi
    $logInfoS "apiIndexer" . T.pack $ "Fetched " ++ show (length idxEvents) ++ " events starting from " ++ show offset
    let blocks = [b | RanBlock b <- idxEvents]
    let nums = map (blockDataNumber . obBlockData) blocks
        nextOffset' = offset + fromIntegral (length idxEvents)
        insertCount = length blocks
    $logInfoS "apiIndexer" . T.pack $ show insertCount ++ " of them are blocks"
    when (insertCount > 0) $ do
        $logInfoS "apiIndexer" . T.pack $ "  (inserting " ++ show insertCount ++ " output blocks)"
        results <- putBlocks [(SHA 0, 0)] (outputBlockToBlock <$> blocks) False
        let bids = fst <$> results
        IndexerBestBlockInfo bestBid <- getIndexerBestBlockInfo
        num <- blockDataNumber . blockBlockData <$> sqlQuery (getJust bestBid)
        let (num', bid) = maximumBy (comparing fst) $ zip nums bids
        when (num' > num || num' == 0) $ putIndexerBestBlockInfo (IndexerBestBlockInfo bid)
    setKafkaCheckpoint nextOffset' =<< getIndexerBestBlockInfo

kafkaClientIds :: (KafkaClientId, ConsumerGroup)
kafkaClientIds = ("strato-api-indexer", lookupConsumerGroup "strato-api-indexer")

getKafkaCheckpoint :: IContextM (Offset, IndexerBestBlockInfo)
getKafkaCheckpoint = withKafkaViolently (fetchSingleOffset (snd kafkaClientIds) targetTopicName 0) >>= \case
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
    evs       <- withKafkaViolently (readIndexEvents ofs)
    return (ofs, evs, md)
