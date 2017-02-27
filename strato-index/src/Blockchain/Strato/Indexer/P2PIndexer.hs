{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# OPTIONS -fno-warn-unused-imports #-}
module Blockchain.Strato.Indexer.P2PIndexer where

import           Control.Monad
import           Control.Monad.Logger
import           Data.List                          hiding (group)
import qualified Data.Text                          as T
import           Network.Kafka
import           Network.Kafka.Consumer
import           Network.Kafka.Protocol

import           Blockchain.Data.BlockDB
import           Blockchain.DB.SQLDB
import           Blockchain.EthConf                 (lookupConsumerGroup)
import           Blockchain.Format
import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Kafka
import           Blockchain.Strato.Model.SHA

import           Blockchain.Strato.Indexer.IContext
import           Blockchain.Strato.Indexer.Kafka
import           Blockchain.Strato.Indexer.Model

import           Data.Ord

import qualified Blockchain.Strato.RedisBlockDB     as RBDB

p2pIndexer :: LoggingT IO ()
p2pIndexer = runIContextM "strato-p2p-indexer" . forever $ do
    $logInfoS "p2pIndexer" "About to fetch IndexEvents"
    (offset, idxEvents) <- getUnprocessedIndexEvents
    $logInfoS "p2pIndexer" . T.pack $ "Fetched " ++ show (length idxEvents) ++ " events starting from " ++ show offset
    let zipIdxEvents = zip [offset+1..] idxEvents
    forM_ zipIdxEvents $ \(nextIdx, e) -> do
        void $ case e of
            RanBlock b -> do
                $logInfoS "p2pIndexer" . T.pack $ "Inserting Redis block with sha: " ++ format (blockHash b)
                RBDB.withRedisBlockDB (RBDB.putBlock b)
            NewBestBlock (sha, num, tdiff) -> do
                $logInfoS "p2pIndexer" . T.pack $
                    "Updating RedisBestBlock as (" ++ format sha ++ ", " ++ show num ++ ", " ++ show tdiff ++ ")"
                RBDB.withRedisBlockDB (RBDB.putBestBlockInfo sha num tdiff)
        setKafkaCheckpoint nextIdx

kafkaClientIds :: (KafkaClientId, ConsumerGroup)
kafkaClientIds = ("strato-p2p-indexer", lookupConsumerGroup "strato-p2p-indexer")

getKafkaCheckpoint :: IContextM Offset
getKafkaCheckpoint = withKafkaViolently (fetchSingleOffset (snd kafkaClientIds) targetTopicName 0) >>= \case
    Left UnknownTopicOrPartition -> setKafkaCheckpoint 0 >> getKafkaCheckpoint
    Left err -> error $ "Unexpected response when fetching offset for " ++ show targetTopicName ++ ": " ++ show err
    Right (ofs, _)  -> return ofs

setKafkaCheckpoint :: Offset -> IContextM ()
setKafkaCheckpoint ofs = do
    $logInfoS "setKafkaCheckpoint" . T.pack $ "Setting checkpoint to " ++ show ofs
    withKafkaViolently (commitSingleOffset (snd kafkaClientIds) targetTopicName 0 ofs "") >>= \case
        Left err -> error $ "Unexpected response when setting checkpoint to " ++ show ofs ++ ": " ++ show err
        Right () -> return ()

getUnprocessedIndexEvents :: IContextM (Offset, [IndexEvent])
getUnprocessedIndexEvents = do
    ofs <- getKafkaCheckpoint
    evs <- withKafkaViolently (readIndexEvents ofs)
    return (ofs, evs)
