{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

module Blockchain.Strato.Indexer.ApiIndexer
    ( apiIndexer
    ) where

import           Control.Monad
import           Control.Monad.Logger
import           Data.List                          hiding (group)
import qualified Data.Text                          as T
import           Network.Kafka
import           Network.Kafka.Protocol

import           Blockchain.Data.BlockDB
import           Blockchain.DB.SQLDB
import           Blockchain.Format
import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Kafka
import           Blockchain.SHA

import           Blockchain.Strato.Indexer.IContext

import           Data.Ord
import           Database.Persist.Sql

import qualified Blockchain.Strato.RedisBlockDB     as RBDB

apiIndexer :: LoggingT IO ()
apiIndexer = runIContextM (fst kafkaClientIds) . forever $ do
    $logInfoS "stratoIndex" "About to fetch blocks"
    (offset, seqEvents, bbi) <- getUnprocessedSeqEvents
    putIndexerBestBlockInfo bbi
    $logInfoS "stratoIndex" . T.pack $ "Fetched " ++ show (length seqEvents) ++ " events starting from " ++ show offset
    let blocks = [b | OEBlock b <- seqEvents]
    let nums = map (blockDataNumber . obBlockData) blocks
        nextOffset' = offset + fromIntegral (length seqEvents)
        insertCount = length blocks
    $logInfoS "stratoIndex" . T.pack $ show insertCount ++ " of them are blocks"
    when (insertCount > 0) $ do
        $logInfoS "stratoIndex" . T.pack $ "  (inserting " ++ show insertCount ++ " output blocks)"
        results <- putBlocks [(SHA 0, 0)] (outputBlockToBlock <$> blocks) False
        let bids = fst <$> results
        IndexerBestBlockInfo bestBid <- getIndexerBestBlockInfo
        num <- blockDataNumber . blockBlockData <$> sqlQuery (getJust bestBid)
        let (num', bid) = maximumBy (comparing fst) $ zip nums bids
        when (num' > num || num' == 0) $ putIndexerBestBlockInfo (IndexerBestBlockInfo bid)
        forM_ blocks $ \b -> do
            $logInfoS "stratoIndex/redis" . T.pack $ "Inserting Redis block with sha: " ++ format (blockHash b)
            RBDB.withRedisBlockDB (RBDB.putBlock b)
    setKafkaCheckpoint nextOffset' =<< getIndexerBestBlockInfo

getUnprocessedSeqEvents :: IContextM (Offset, [OutputEvent], IndexerBestBlockInfo)
getUnprocessedSeqEvents = do
    (ofs, md) <- getKafkaCheckpoint
    evs       <- withKafkaViolently (readSeqEventsFromTopic targetTopicName ofs)
    return (ofs, evs, md)
