{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
module Blockchain.Strato.Indexer.TxrIndexer where

import           Control.Monad
import           Control.Monad.Logger
import qualified Data.Text                          as T
import           Network.Kafka
import           Network.KafkaExt
import           Network.Kafka.ConsumerExt
import           Network.Kafka.Protocol

import           Blockchain.Data.DataDefs           (LogDB (..), TransactionResult (..))
import qualified Blockchain.Data.LogDB              as LogDB
import qualified Blockchain.Data.TransactionResult  as TxrDB
import           Blockchain.EthConf                 (lookupConsumerGroup)
import           Blockchain.Format

import           Blockchain.Strato.Indexer.IContext
import           Blockchain.Strato.Indexer.Kafka
import           Blockchain.Strato.Indexer.Model


txrIndexer :: LoggingT IO ()
txrIndexer = runIContextM "strato-txr-indexer" . forever $ do
    $logInfoS "txrIndexer" "About to fetch IndexEvents"
    (offset, idxEvents) <- getUnprocessedIndexEvents
    $logInfoS "txrIndexer" . T.pack $ "Fetched " ++ show (length idxEvents) ++ " events starting from " ++ show offset
    let zipIdxEvents = zip [offset+1..] idxEvents
    forM_ zipIdxEvents $ \(nextIdx, e) -> do -- todo: don't insert one-by-one?
        case e of
            LogDBEntry l -> do
                $logInfoS "txrIndexer" . T.pack $ "Inserting LogDB entry for tx: " ++ format (logDBTransactionHash l) ++ " at block " ++ format (logDBBlockHash l)
                void $ LogDB.putLogDB l
            TxResult r -> do
                $logInfoS "txrIndexer" . T.pack $
                    "Inserting TXResult for tx " ++ format (transactionResultTransactionHash r) ++ " at block " ++ format (transactionResultBlockHash r)
                void $ TxrDB.putTransactionResult r
            _ -> return ()
        setKafkaCheckpoint nextIdx

kafkaClientIds :: (KafkaClientId, ConsumerGroup)
kafkaClientIds = ("strato-txr-indexer", lookupConsumerGroup "strato-txr-indexer")

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
