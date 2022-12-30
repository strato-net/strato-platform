{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeOperators     #-}
{-# LANGUAGE DataKinds         #-}
module Blockchain.Strato.Indexer.ApiIndexer
    ( apiIndexer
    , indexAPI
    , kafkaClientIds
    ) where

import           Control.Arrow                      ((&&&))
import           Control.Monad
import qualified Control.Monad.Change.Alter         as A
import qualified Data.ByteString.Char8              as S8
import qualified Data.Map.Strict                    as M
import qualified Data.Text                          as T
import           Network.Kafka
import           Blockchain.MilenaTools
import           Network.Kafka.Protocol

import           BlockApps.Logging
import           Blockchain.Data.DataDefs
import           Blockchain.Data.ChainInfo
import           Blockchain.EthConf                 (lookupConsumerGroup)
import           Blockchain.Strato.Indexer.IContext
import           Blockchain.Strato.Indexer.Kafka
import           Blockchain.Strato.Indexer.Model
import           Blockchain.Strato.Model.ChainMember
import           Blockchain.Strato.Model.Class      (blockHash)
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.Keccak256

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
            , (Keccak256 `A.Alters` API OutputTx) m
            , (Word256 `A.Alters` API ChainInfo) m
            , (Keccak256 `A.Alters` API OutputBlock) m
            , (([ChainMemberParsedSet],[ChainMemberParsedSet]) `A.Alters` API (A.Proxy ValidatorRef)) m
            )
         => [IndexEvent] -> m ()
indexAPI idxEvents = do
  let (txs, chainInfos, blocks, validators) = filterHelper idxEvents ([],[],[],[])
      insertCount = length blocks

  A.insertMany (A.Proxy @(API OutputTx)) . M.fromList $ (otHash &&& API) <$> txs
  A.insertMany (A.Proxy @(API ChainInfo)) . M.fromList $ fmap API <$> chainInfos

  when (length validators > 0) . forM_ validators $ \x -> A.insert (A.Proxy @(API (A.Proxy ValidatorRef))) x $ API A.Proxy

  $logInfoS "apiIndexer" . T.pack $ show insertCount ++ " of them are blocks"
  when (insertCount > 0) $ do
    $logInfoS "apiIndexer" . T.pack $ "  (inserting " ++ show insertCount ++ " output blocks)"
    A.insertMany (A.Proxy @(API OutputBlock)) . M.fromList $ (blockHash &&& API) <$> blocks
  
  where
    filterHelper :: [IndexEvent] -> ([OutputTx], [(Word256, ChainInfo)], [OutputBlock], [([ChainMemberParsedSet], [ChainMemberParsedSet])]) -> ([OutputTx], [(Word256, ChainInfo)], [OutputBlock], [([ChainMemberParsedSet], [ChainMemberParsedSet])])
    filterHelper (indxEv:xs) (indexTransactions,  newChainInfos, ranBlocksLs, validatorLs) = 
      case indxEv of  
        IndexTransaction _ tx  -> filterHelper xs  (tx : indexTransactions,  newChainInfos, ranBlocksLs, validatorLs)
        NewChainInfo cId cInfo -> filterHelper xs  (indexTransactions,  (cId, cInfo) : newChainInfos, ranBlocksLs, validatorLs)
        RanBlock b             -> filterHelper xs  (indexTransactions,  newChainInfos, b : ranBlocksLs, validatorLs)
        ValidatorsG x          -> filterHelper xs  (indexTransactions,  newChainInfos, ranBlocksLs, x:validatorLs)
        _ -> filterHelper xs (indexTransactions,  newChainInfos, ranBlocksLs, validatorLs)
    filterHelper [] a = a

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
    op <- withKafkaRetry1s (setKafkaCheckpoint' ofs)
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
