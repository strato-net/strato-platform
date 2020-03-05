{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeOperators     #-}
module Blockchain.Strato.Indexer.ApiIndexer
    ( apiIndexer
    , indexAPI
    , kafkaClientIds
    ) where

import           Control.Arrow                      ((&&&))
import           Control.Monad
import qualified Control.Monad.Change.Alter         as A
import           Blockchain.Output
import qualified Data.ByteString.Char8              as S8
import qualified Data.Map.Strict                    as M
import qualified Data.Text                          as T
import           Network.Kafka
import           Blockchain.MilenaTools
import           Network.Kafka.Protocol

import           Blockchain.Data.BlockDB
import           Blockchain.Data.ChainInfo
import           Blockchain.EthConf                 (lookupConsumerGroup)
import           Blockchain.ExtWord
import           Blockchain.Strato.Indexer.IContext
import           Blockchain.Strato.Indexer.Kafka
import           Blockchain.Strato.Indexer.Model
import           Blockchain.Strato.Model.SHA

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

indexAPI :: ( MonadLogger m
            , (SHA `A.Alters` API OutputTx) m
            , (Word256 `A.Alters` API ChainInfo) m
            , (SHA `A.Alters` API OutputBlock) m
            )
         => [IndexEvent] -> m ()
indexAPI idxEvents = do
  let txs = [tx | IndexTransaction _ tx <- idxEvents]
      chainInfos = [(cId, cInfo) | NewChainInfo cId cInfo <- idxEvents]
      blocks = [b | RanBlock b <- idxEvents]
      insertCount = length blocks

  A.insertMany (A.Proxy @(API OutputTx)) . M.fromList $ (otHash &&& API) <$> txs
  A.insertMany (A.Proxy @(API ChainInfo)) . M.fromList $ fmap API <$> chainInfos

  $logInfoS "apiIndexer" . T.pack $ show insertCount ++ " of them are blocks"
  when (insertCount > 0) $ do
    $logInfoS "apiIndexer" . T.pack $ "  (inserting " ++ show insertCount ++ " output blocks)"
    A.insertMany (A.Proxy @(API OutputBlock)) . M.fromList $ (blockHash &&& API) <$> blocks

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
setKafkaCheckpoint' = commitSingleOffset (snd kafkaClientIds) targetTopicName 0 `flip` indexerMetadata

getUnprocessedIndexEvents :: IContextM (Offset, [IndexEvent])
getUnprocessedIndexEvents = do
    ofs <- getKafkaCheckpoint
    evs <- withKafkaRetry1s (readIndexEvents ofs)
    return (ofs, evs)
