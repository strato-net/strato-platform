{-# LANGUAGE OverloadedStrings, TemplateHaskell, LambdaCase #-}

module Executable.StratoIndex (
    stratoIndex
) where

import Control.Lens hiding (Context)
import Control.Monad
import Control.Monad.IO.Class
import Control.Monad.Logger
import Data.List
import qualified Data.Text as T
import Network.Kafka
import Network.Kafka.Consumer
import Network.Kafka.Protocol

import Blockchain.Constants
import Blockchain.Data.BlockDB
import Blockchain.Data.Extra
import Blockchain.SHA
import Blockchain.DB.SQLDB
import Blockchain.IContext
import Blockchain.IOptions
import Blockchain.SemiPermanent
import Blockchain.Stream.VMEvent
import Blockchain.EthConf
import Blockchain.Util


import Data.Ord
import Database.Persist.Sql


stratoIndex :: LoggingT IO ()
stratoIndex = runIContextM . forever $ do
    $logInfoS "stratoIndex" "About to fetch blocks"
    (offset, vmEvents) <- getUnprocessedKafkaVMEvents
    $logInfoS "stratoIndex" . T.pack $ "Fetched " ++ show (length vmEvents) ++ " events starting from " ++ show offset
    let blocks = [b | ChainBlock b <- vmEvents]
    $logInfoS "stratoIndex" . T.pack $ show (length blocks) ++ " of them are blocks"
    let nums = map (blockDataNumber . blockBlockData) blocks
        nextOffset' = offset + fromIntegral (length vmEvents)
        minedBlocks = filter isMined blocks
        insertCount = length minedBlocks
    if insertCount > 0 then do
        $logInfoS "stratoIndex" $ T.pack $ "  (" ++ show insertCount ++ " of those blocks are mined; inserting those)"
        results <- putBlocks [(SHA 0, 0)] minedBlocks False
        let bids = fst <$> results
        bestBid <- getBestIndexBlockInfo
        num <- fmap (blockDataNumber . blockBlockData) $ sqlQuery $ getJust bestBid
        let (num', bid) = maximumBy (comparing fst) $ zip nums bids
        when (num' > num || num' == 0) $ putBestIndexBlockInfo bid
    else
        $logInfoS "stratoIndex" "  (all unmined, not inserting any)"
    setKafkaCheckpoint nextOffset'

isMined :: Block->Bool
isMined Block{blockBlockData=BlockData{blockDataNonce=n}} = n /= 5

kafkaClientIds :: (KafkaClientId, ConsumerGroup)
kafkaClientIds = ("strato-index", lookupConsumerGroup "strato-index")

getUnprocessedKafkaVMEvents :: (MonadLogger m, MonadIO m) => m (Offset, [VMEvent])
getUnprocessedKafkaVMEvents = do
  let topicName       = defaultVMEventsTopicName
      (client, group) = kafkaClientIds
  liftIO (runKafkaConfigured client (fetchSingleOffset group topicName 0)) >>= \case
    Left err -> error $ "Error fetching offset for topic `" ++ show topicName ++ "`: " ++ show err
    Right (Left UnknownTopicOrPartition) -> -- we've never committed an Offset
        setKafkaCheckpoint 0 >>= \case
            Left err -> error $ "Error when bootstrapping the offset to 0: " ++ show err
            Right (Left err) -> error $ "Unexpected response when bootstrapping the offset of 0: " ++ show err
            Right (Right ()) -> getUnprocessedKafkaVMEvents
    Right (Left err) -> error $ "Unexpected response when fetching offset for topic `" ++ show topicName ++ "`: " ++ show err
    Right (Right (ofs, _)) ->
        liftIO (runKafkaConfigured client (fetchVMEvents' ofs)) >>= \case
            Left  err    -> error $ "Error when fetching VMEvents at " ++ show ofs ++ ": " ++ show err
            Right events -> return (ofs, events)

setKafkaCheckpoint :: (MonadLogger m, MonadIO m) => Offset -> m (Either KafkaClientError (Either KafkaError ()))
setKafkaCheckpoint ofs = do
    let (client, group) = kafkaClientIds
    time <- liftIO $ Time . fromIntegral <$> getCurrentMicrotime
    $logInfoS "setKafkaCheckpoint" . T.pack $ "Setting checkpoint to " ++ show ofs
    liftIO $ runKafkaConfigured client $ commitSingleOffset group defaultVMEventsTopicName 0 ofs time ""
