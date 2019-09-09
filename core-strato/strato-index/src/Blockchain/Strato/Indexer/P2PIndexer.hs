{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
module Blockchain.Strato.Indexer.P2PIndexer where

import           Control.Arrow                      ((&&&))
import           Control.Monad
import           Blockchain.Output
import           Data.Maybe                         (fromJust)
import qualified Data.Text                          as T
import           Network.Kafka
import           Blockchain.MilenaTools
import           Network.Kafka.Protocol

import           Blockchain.Data.BlockDB
import           Blockchain.Data.ChainInfo
import           Blockchain.EthConf                 (lookupConsumerGroup)

import           Blockchain.Strato.Indexer.IContext
import           Blockchain.Strato.Indexer.Kafka
import           Blockchain.Strato.Indexer.Model
import           Blockchain.Strato.Model.Class

import qualified Blockchain.Strato.RedisBlockDB     as RBDB

import           Text.Format

p2pIndexer :: LoggingT IO ()
p2pIndexer = runIContextM "strato-p2p-indexer" . forever $ do
    $logInfoS "p2pIndexer" "About to fetch IndexEvents"
    (offset, idxEvents) <- getUnprocessedIndexEvents
    $logInfoS "p2pIndexer" . T.pack $ "Fetched " ++ show (length idxEvents) ++ " events starting from " ++ show offset
    let zipIdxEvents = zip [offset+1..] idxEvents
        ptxs = [t | (_,IndexPrivateTx t) <- zipIdxEvents]
    unless (null ptxs)
      . void
      . RBDB.withRedisBlockDB
      . RBDB.addPrivateTransactions
      $ map (txHash &&& (fromJust . txChainId &&& id)) ptxs
    forM_ zipIdxEvents $ \(nextIdx, e) -> do
        case e of
            RanBlock b -> do
                $logInfoS "p2pIndexer" . T.pack $ "Inserting Redis block with sha: " ++ format (blockHash b)
                void $ RBDB.withRedisBlockDB (RBDB.putBlock b)
            NewBestBlock (sha, num, tdiff) -> do
                $logInfoS "p2pIndexer" . T.pack $
                    "Updating RedisBestBlock as (" ++ format sha ++ ", " ++ show num ++ ", " ++ show tdiff ++ ")"
                void $ RBDB.withRedisBlockDB (RBDB.putBestBlockInfo sha num tdiff)
            NewChainInfo cId cInfo -> do
                $logInfoS "p2pIndexer" . T.pack $
                    "Inserting ChainInfo for chain " ++ format cId ++ ": " ++ show cInfo
                void . RBDB.withRedisBlockDB $ RBDB.putChainInfo cId cInfo
                let cMembers = members $ chainInfo cInfo
                void . RBDB.withRedisBlockDB $ RBDB.putChainMembers cId cMembers
            _ -> return ()
        setKafkaCheckpoint nextIdx

kafkaClientIds :: (KafkaClientId, ConsumerGroup)
kafkaClientIds = ("strato-p2p-indexer", lookupConsumerGroup "strato-p2p-indexer")

getKafkaCheckpoint :: IContextM Offset
getKafkaCheckpoint = withKafkaRetry1s (fetchSingleOffset (snd kafkaClientIds) targetTopicName 0) >>= \case
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
    evs <- withKafkaRetry1s (readIndexEvents ofs)
    return (ofs, evs)
