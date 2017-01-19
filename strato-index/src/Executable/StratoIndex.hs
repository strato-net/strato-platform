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
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import Blockchain.EthConf
import Blockchain.Util


import Data.Ord
import Database.Persist.Sql


stratoIndex :: LoggingT IO ()
stratoIndex = runIContextM (fst kafkaClientIds) . forever $ do
    $logInfoS "stratoIndex" "About to fetch blocks"
    (offset, seqEvents) <- getUnprocessedSeqEvents
    $logInfoS "stratoIndex" . T.pack $ "Fetched " ++ show (length seqEvents) ++ " events starting from " ++ show offset
    let blocks = [b | OEBlock b <- seqEvents]
    let nums = map (blockDataNumber . obBlockData) blocks
        nextOffset' = offset + fromIntegral (length seqEvents)
        insertCount = length blocks
    $logInfoS "stratoIndex" . T.pack $ show insertCount ++ " of them are blocks"
    when (insertCount > 0) $ do
        $logInfoS "stratoIndex" . T.pack $ "  (inserting " ++ show insertCount ++ " output blocks)"
        results <- putBlocks [(SHA 0, 0)] (outputBlockToBlock <$> blocks) False
        let bids = fst <$> results
        bestBid <- getBestIndexBlockInfo
        num <- blockDataNumber . blockBlockData <$> sqlQuery (getJust bestBid)
        let (num', bid) = maximumBy (comparing fst) $ zip nums bids
        when (num' > num || num' == 0) $ putBestIndexBlockInfo bid
    setKafkaCheckpoint nextOffset'

targetTopicName :: TopicName
targetTopicName = seqEventsTopicName

kafkaClientIds :: (KafkaClientId, ConsumerGroup)
kafkaClientIds = ("strato-index", lookupConsumerGroup "strato-index")

getUnprocessedSeqEvents :: IContextM (Offset, [OutputEvent])
getUnprocessedSeqEvents = do
  let group = snd kafkaClientIds
  withKafkaViolently (fetchSingleOffset group targetTopicName 0) >>= \case
    Left UnknownTopicOrPartition -> -- we've never committed an Offset
        setKafkaCheckpoint 0 >>= \case
            Left err -> error $ "Unexpected response when bootstrapping the offset of 0: " ++ show err
            Right () -> getUnprocessedSeqEvents
    Left err -> error $ "Unexpected response when fetching offset for " ++ show targetTopicName ++ ": " ++ show err
    Right (ofs, _) -> withKafkaViolently (readSeqEvents ofs) >>= \evs -> return (ofs, evs)

setKafkaCheckpoint :: Offset -> IContextM (Either KafkaError ())
setKafkaCheckpoint ofs = do
    let group = snd kafkaClientIds
    $logInfoS "setKafkaCheckpoint" . T.pack $ "Setting checkpoint to " ++ show ofs
    withKafkaViolently $ commitSingleOffset group targetTopicName 0 ofs ""
