{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeOperators     #-}
module Blockchain.Strato.Indexer.P2PIndexer where

import           Control.Arrow                      ((&&&))
import           Control.Monad
import qualified Control.Monad.Change.Alter         as A
import qualified Control.Monad.Change.Modify        as Mod
import           Blockchain.Output
import           Data.Maybe                         (fromJust)
import qualified Data.Map.Strict                    as M
import qualified Data.Text                          as T
import           Network.Kafka
import           Blockchain.MilenaTools
import           Network.Kafka.Protocol

import           Blockchain.Data.Block              (BestBlock(..), Private(..))
import           Blockchain.Data.BlockDB
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.Enode              (ChainMembers(..))
import           Blockchain.EthConf                 (lookupConsumerGroup)
import           Blockchain.ExtWord

import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Indexer.IContext
import           Blockchain.Strato.Indexer.Kafka
import           Blockchain.Strato.Indexer.Model
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.SHA

import           Text.Format

p2pIndexer :: LoggingT IO ()
p2pIndexer = runIContextM "strato-p2p-indexer" . forever $ do
    $logInfoS "p2pIndexer" "About to fetch IndexEvents"
    (offset, idxEvents) <- getUnprocessedIndexEvents
    $logInfoS "p2pIndexer" . T.pack $ "Fetched " ++ show (length idxEvents) ++ " events starting from " ++ show offset
    indexP2P idxEvents
    let nextOffset' = offset + fromIntegral (length idxEvents)
    setKafkaCheckpoint nextOffset'

indexP2P :: ( MonadLogger m
            , (SHA `A.Alters` P2P (Private (Word256, OutputTx))) m
            , (SHA `A.Alters` P2P OutputBlock) m
            , Mod.Modifiable (P2P BestBlock) m
            , (Word256 `A.Alters` P2P ChainInfo) m
            , (Word256 `A.Alters` P2P ChainMembers) m
            )
         => [IndexEvent] -> m ()
indexP2P idxEvents = do
  let ptxs = [t | IndexPrivateTx t <- idxEvents]
  unless (null ptxs) . A.insertMany (A.Proxy @(P2P (Private (Word256, OutputTx))))
                     . M.fromList
                     . map (fmap (P2P . Private))
                     $ map (txHash &&& (fromJust . txChainId &&& id)) ptxs
  forM_ idxEvents $ \case
    RanBlock b -> do
      $logInfoS "p2pIndexer" . T.pack $ "Inserting Redis block with sha: " ++ format (blockHash b)
      A.insert (A.Proxy @(P2P OutputBlock)) (blockHash b) $ P2P b
    NewBestBlock (sha, num, tdiff) -> do
      $logInfoS "p2pIndexer" . T.pack $
        "Updating RedisBestBlock as (" ++ format sha ++ ", " ++ show num ++ ", " ++ show tdiff ++ ")"
      Mod.put (Mod.Proxy @(P2P BestBlock)) . P2P $ BestBlock sha num tdiff
    NewChainInfo cId cInfo -> do
      $logInfoS "p2pIndexer" . T.pack $
        "Inserting ChainInfo for chain " ++ format cId ++ ": " ++ show cInfo
      A.insert (A.Proxy @(P2P ChainInfo)) cId $ P2P cInfo
      let cMembers = members $ chainInfo cInfo
      A.insert (A.Proxy @(P2P ChainMembers)) cId (P2P $ ChainMembers cMembers)
    _ -> return ()

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
