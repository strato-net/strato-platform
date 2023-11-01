{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Strato.Indexer.ApiIndexer
  ( apiIndexerMainLoop,
    indexAPI,
    kafkaClientIds,
  )
where

import BlockApps.Logging
import Blockchain.Data.ChainInfo
import Blockchain.EthConf (lookupConsumerGroup)
import Blockchain.MilenaTools
import Blockchain.Sequencer.Event
import Blockchain.Strato.Indexer.IContext
import Blockchain.Strato.Indexer.Kafka
import Blockchain.Strato.Indexer.Model
import Blockchain.Strato.Model.Class (blockHash)
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Control.Arrow ((&&&))
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Composable.Kafka
import Control.Monad.IO.Class
import qualified Data.ByteString.Char8 as S8
import qualified Data.Map.Strict as M
import qualified Data.Text as T
import Network.Kafka
import Network.Kafka.Protocol

apiIndexerMainLoop :: ( MonadIO m,
                        MonadLogger m,
                        HasKafka m,
                        (Keccak256 `A.Alters` API OutputTx) m,
                        (Word256 `A.Alters` API ChainInfo) m,
                        (Keccak256 `A.Alters` API OutputBlock) m
                      ) =>
                      m ()
apiIndexerMainLoop = 
  forever $ do
    $logInfoS "apiIndexer" "About to fetch blocks"
    (offset, idxEvents) <- getUnprocessedIndexEvents
    $logInfoS "apiIndexer" . T.pack $ "Fetched " ++ show (length idxEvents) ++ " events starting from " ++ show offset
    indexAPI idxEvents
    let nextOffset' = offset + fromIntegral (length idxEvents)
    setKafkaCheckpoint nextOffset'

indexAPI ::
  ( MonadLogger m,
    (Keccak256 `A.Alters` API OutputTx) m,
    (Word256 `A.Alters` API ChainInfo) m,
    (Keccak256 `A.Alters` API OutputBlock) m
  ) =>
  [IndexEvent] ->
  m ()
indexAPI idxEvents = do
  let (txs, chainInfos, blocks) = filterHelper idxEvents ([], [], [])
      insertCount = length blocks

  A.insertMany (A.Proxy @(API OutputTx)) . M.fromList $ (otHash &&& API) <$> txs
  A.insertMany (A.Proxy @(API ChainInfo)) . M.fromList $ fmap API <$> chainInfos

  $logInfoS "apiIndexer" . T.pack $ show insertCount ++ " of them are blocks"
  when (insertCount > 0) $ do
    $logInfoS "apiIndexer" . T.pack $ "  (inserting " ++ show insertCount ++ " output blocks)"
    A.insertMany (A.Proxy @(API OutputBlock)) . M.fromList $ (blockHash &&& API) <$> blocks
  where
    filterHelper :: [IndexEvent] -> ([OutputTx], [(Word256, ChainInfo)], [OutputBlock]) -> ([OutputTx], [(Word256, ChainInfo)], [OutputBlock])
    filterHelper (indxEv : xs) (indexTransactions, newChainInfos, ranBlocksLs) =
      case indxEv of
        IndexTransaction _ tx -> filterHelper xs (tx : indexTransactions, newChainInfos, ranBlocksLs)
        NewChainInfo cId cInfo -> filterHelper xs (indexTransactions, (cId, cInfo) : newChainInfos, ranBlocksLs)
        RanBlock b -> filterHelper xs (indexTransactions, newChainInfos, b : ranBlocksLs)
        _ -> filterHelper xs (indexTransactions, newChainInfos, ranBlocksLs)
    filterHelper [] a = a

kafkaClientIds :: (KafkaClientId, ConsumerGroup)
kafkaClientIds = ("strato-api-indexer", lookupConsumerGroup "strato-api-indexer")

getKafkaCheckpoint :: (MonadIO m, HasKafka m) =>
                      m Offset
getKafkaCheckpoint =
  execKafka (fetchSingleOffset (snd kafkaClientIds) targetTopicName 0) >>= \case
    Left UnknownTopicOrPartition -> error "ApiIndexerBestBlock was never initialized in strato-setup!"
    Left err -> error $ "Unexpected response when fetching offset for " ++ show targetTopicName ++ ": " ++ show err
    Right r -> pure $ fst r

setKafkaCheckpoint :: (MonadIO m, MonadLogger m, HasKafka m) =>
                      Offset -> m ()
setKafkaCheckpoint ofs = do
  $logInfoS "setKafkaCheckpoint" . T.pack $ "Setting checkpoint to " ++ show ofs
  op <- execKafka (setKafkaCheckpoint' ofs)
  case op of
    Left err -> error $ "Client error: " ++ show err
    Right _ -> return ()

indexerMetadata :: Metadata
indexerMetadata = Metadata $ KString S8.empty

setKafkaCheckpoint' :: Kafka k => Offset -> k (Either KafkaError ())
setKafkaCheckpoint' = commitSingleOffset (snd kafkaClientIds) targetTopicName 0 `flip` indexerMetadata

getUnprocessedIndexEvents :: (MonadIO m, HasKafka m) =>
                             m (Offset, [IndexEvent])
getUnprocessedIndexEvents = do
  ofs <- getKafkaCheckpoint
  evs <- execKafka $ readIndexEvents ofs
  return (ofs, evs)
