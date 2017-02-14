{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

module Blockchain.Strato.Indexer.Main
    ( stratoIndex
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
import           Blockchain.Format
import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Kafka
import           Blockchain.SHA

import           Blockchain.Strato.Indexer.IContext

import           Data.Ord
import           Database.Persist.Sql

import qualified Blockchain.Strato.RedisBlockDB     as RBDB

stratoIndex :: LoggingT IO ()
stratoIndex = runIContextM (fst kafkaClientIds) . forever $ do
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
        bestBid <- getIndexerBestBlockInfo
        num <- blockDataNumber . blockBlockData <$> sqlQuery (getJust bestBid)
        let (num', bid) = maximumBy (comparing fst) $ zip nums bids
        when (num' > num || num' == 0) $ putIndexerBestBlockInfo bid
        forM_ blocks $ \b -> do
            $logInfoS "stratoIndex/redis" . T.pack $ "Inserting Redis block with sha: " ++ format (blockHash b)
            RBDB.withRedisBlockDB (RBDB.putBlock b)
    setKafkaCheckpoint nextOffset'

getUnprocessedSeqEvents :: IContextM (Offset, [OutputEvent], IndexerBestBlockInfo)
getUnprocessedSeqEvents = do
  let group = snd kafkaClientIds
  withKafkaViolently (fetchSingleOffset group targetTopicName 0) >>= \case
    Left UnknownTopicOrPartition -> -- we've never committed an Offset
        setKafkaCheckpoint 0 >>= \case
            Left err -> error $ "Unexpected response when bootstrapping the offset of 0: " ++ show err
            Right () -> getUnprocessedSeqEvents
    Left err -> error $ "Unexpected response when fetching offset for " ++ show targetTopicName ++ ": " ++ show err
    Right (ofs, md) -> withKafkaViolently (readSeqEvents ofs) >>= \evs -> return (ofs, evs, readMetadata md)
        where readMetadata (Metadata (KString md')) = read (S8.unpack md')

setKafkaCheckpoint :: Offset -> IContextM (Either KafkaError ())
setKafkaCheckpoint ofs = do
    let group = snd kafkaClientIds
    bestBlock <- Metadata . KString . S8.pack . show <$> getIndexerBestBlockInfo
    $logInfoS "setKafkaCheckpoint" . T.pack $ "Setting checkpoint to " ++ show ofs
    withKafkaViolently $ commitSingleOffset group targetTopicName 0 ofs bestBlock
