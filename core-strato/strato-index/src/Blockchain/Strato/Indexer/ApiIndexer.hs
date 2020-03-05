{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE TemplateHaskell   #-}
module Blockchain.Strato.Indexer.ApiIndexer
    ( apiIndexer
    , indexAPI
    , kafkaClientIds
    ) where

import           Control.Arrow                      ((&&&))
import           Control.Monad
import           Control.Monad.Trans.Class          (lift)
import           Blockchain.Output
import qualified Data.ByteString.Char8              as S8
import qualified Data.Text                          as T
import           Network.Kafka
import           Blockchain.MilenaTools
import           Network.Kafka.Protocol

import           Blockchain.Data.BlockDB
import           Blockchain.Data.ChainInfoDB        (putChainInfo)
import           Blockchain.Data.Transaction         (insertTX)
import           Blockchain.DBM
import           Blockchain.EthConf                 (lookupConsumerGroup)
import           Blockchain.Strato.Indexer.IContext
import           Blockchain.Strato.Indexer.Kafka
import           Blockchain.Strato.Indexer.Model

import           Blockchain.Sequencer.Event

apiIndexer :: LoggingT IO ()
apiIndexer =  runIContextM "strato-api-indexer" $ do
  forever $ do
    $logInfoS "apiIndexer" "About to fetch blocks"
    (offset, idxEvents) <- getUnprocessedIndexEvents
    $logInfoS "apiIndexer" . T.pack $ "Fetched " ++ show (length idxEvents) ++ " events starting from " ++ show offset
    indexAPI idxEvents
    let nextOffset' = offset + fromIntegral (length idxEvents)
    setKafkaCheckpoint nextOffset'

indexAPI :: [IndexEvent] -> IContextM ()
indexAPI idxEvents = do
  let txs = [tx | IndexTransaction _ tx <- idxEvents]
  lift $ forM_ txs $ \OutputTx{..} -> insertTX Log otOrigin Nothing [otBaseTx]
  let chainInfos = [(cId, cInfo) | NewChainInfo cId cInfo <- idxEvents]
  lift $ forM_ chainInfos . uncurry $ putChainInfo
  let blocks = [b | RanBlock b <- idxEvents]
      insertCount = length blocks
  $logInfoS "apiIndexer" . T.pack $ show insertCount ++ " of them are blocks"
  when (insertCount > 0) $ do
    $logInfoS "apiIndexer" . T.pack $ "  (inserting " ++ show insertCount ++ " output blocks)"
    void . lift $ putBlocks ((outputBlockToBlock &&& obTotalDifficulty) <$> blocks) False

kafkaClientIds :: (KafkaClientId, ConsumerGroup)
kafkaClientIds = ("strato-api-indexer", lookupConsumerGroup "strato-api-indexer")

getKafkaCheckpoint :: IContextM Offset
getKafkaCheckpoint = withKafkaRetry1s (fetchSingleOffset (snd kafkaClientIds) targetTopicName 0) >>= \case
    Left UnknownTopicOrPartition -> error "ApiIndexerBestBlock was never initialized in strato-setup!"
    Left err -> error $ "Unexpected response when fetching offset for " ++ show targetTopicName ++ ": " ++ show err
    Right r  -> pure $ fst r

setKafkaCheckpoint :: Offset -> IContextM ()
setKafkaCheckpoint ofs = do
    $logInfoS "setKafkaCheckpoint" . T.pack $ "Setting checkpoint to " ++ show ofs
    op <- withKafkaViolently (setKafkaCheckpoint' ofs)
    case op of
        Left err -> error $ "Client error: " ++ show err
        Right _  -> return ()

indexerMetadata :: Metadata
indexerMetadata = Metadata $ KString S8.empty

setKafkaCheckpoint' :: Kafka k => Offset -> k (Either KafkaError ())
setKafkaCheckpoint' ofs =
    let group     = snd kafkaClientIds
    in commitSingleOffset group targetTopicName 0 ofs indexerMetadata

getUnprocessedIndexEvents :: IContextM (Offset, [IndexEvent])
getUnprocessedIndexEvents = do
    ofs <- getKafkaCheckpoint
    evs <- withKafkaRetry1s (readIndexEvents ofs)
    return (ofs, evs)
