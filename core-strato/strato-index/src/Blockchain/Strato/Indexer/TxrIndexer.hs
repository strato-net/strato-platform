{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
module Blockchain.Strato.Indexer.TxrIndexer where

import           Control.Monad
import           Control.Monad.Logger
import           Data.Binary
import qualified Data.ByteString                    as BS
import qualified Data.ByteString.Lazy               as BL
import           Data.Maybe                         (isJust)
import qualified Data.Text                          as T
import           Network.Kafka
import           Blockchain.MilenaTools
import           Network.Kafka.Protocol

import           Blockchain.Data.ChainInfoDB        (addMember, removeMember, terminateChain)
import           Blockchain.Data.DataDefs           (LogDB (..), TransactionResult (..))
import qualified Blockchain.Data.LogDB              as LogDB
import           Blockchain.Data.MiningStatus
import qualified Blockchain.Data.TransactionResult  as TxrDB
import           Blockchain.EthConf                 (lookupConsumerGroup)
import           Blockchain.Format

import           Blockchain.Strato.Indexer.IContext
import           Blockchain.Strato.Indexer.Kafka
import           Blockchain.Strato.Indexer.Model
import           Blockchain.Strato.Model.SHA

import           Numeric

addTopic :: SHA
addTopic = SHA 0xb251eb052afc73ffd02ffe85ad79990a8b3fed60d76dbc2fa2fdd7123dffd914

removeTopic :: SHA
removeTopic = SHA 0x6e76fb4c77256006d9c38ec7d82b45a8c8f3c27b1d6766fffc42dfb8de684492

terminateTopic :: SHA
terminateTopic = SHA 0xa216b6c57c66c6aca0a555ec262cc200b54bc3171354e33ff842740444e5e206

txrIndexer :: LoggingT IO ()
txrIndexer = runIContextM "strato-txr-indexer" . forever $ do
    $logInfoS "txrIndexer" "About to fetch IndexEvents"
    (offset, idxEvents) <- getUnprocessedIndexEvents
    $logInfoS "txrIndexer" . T.pack $ "Fetched " ++ show (length idxEvents) ++ " events starting from " ++ show offset
    let zipIdxEvents = zip [offset+1..] idxEvents
    forM_ zipIdxEvents $ \(nextIdx, e) -> do -- todo: don't insert one-by-one?
        case e of
            LogDBEntry l -> do
                let mChainId = logDBChainId l
                    topic1 = logDBTopic1 l
                $logInfoS "txrIndexer" . T.pack $ "Inserting LogDB entry for tx: " ++ format (logDBTransactionHash l) ++ " on chain " ++ show (flip showHex "" <$> mChainId) ++ " at block " ++ format (logDBBlockHash l)
                when (isJust mChainId) $ do
                  let Just chainId = mChainId
                  case topic1 of
                    Just x | SHA x == addTopic -> do
                      let address = decode . BL.fromStrict . BS.take 20 . BS.drop 12 $ logDBTheData l
                      $logInfoS "txrIndexer" . T.pack $ "Adding member " ++ (showHex address "") ++ " on chain " ++ showHex chainId ""
                      addMember chainId address
                    Just x | SHA x == removeTopic -> do
                      let address = decode . BL.fromStrict . BS.take 20 . BS.drop 12 $ logDBTheData l
                      $logInfoS "txrIndexer" . T.pack $ "Removing member " ++ (showHex address "") ++ " on chain " ++ showHex chainId ""
                      removeMember chainId address
                    Just x | SHA x == terminateTopic -> do
                      $logInfoS "txrIndexer" . T.pack $ "Terminating chain " ++ showHex chainId ""
                      terminateChain chainId
                    _ -> return ()
                void $ LogDB.putLogDB l
            InsertTxResult r -> do
                $logInfoS "txrIndexer" . T.pack $
                    "Inserting TXResult for tx " ++ format (transactionResultTransactionHash r) ++ " at block " ++ format (transactionResultBlockHash r)
                void $ TxrDB.putInsertTransactionResult r
            UpdateTxResult u@(t,o,n,m) -> do
                $logInfoS "txrIndexer" . T.pack $
                    "Updating TXResult for " ++ format t ++ " from block hash " ++ format o ++ " to block hash " ++ format n ++ " with mining status " ++ (if m == Mined then "Mined" else "Unmined") -- easier than making a Format instance
                void $ TxrDB.putUpdateTransactionResult u
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
