{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Strato.Indexer.Kafka
  ( indexEventsTopicName,
    produce,
    consume
  )
where

import BlockApps.Logging
import Blockchain.KafkaTopics (lookupTopic)
import Blockchain.MilenaTools
import Blockchain.Stream.Raw (fetchBytes, setDefaultKafkaState)
import Control.Monad
import Control.Monad.Composable.Kafka
import Control.Monad.IO.Class
import Data.Binary
import qualified Data.ByteString.Lazy as L
import Data.Text (Text)
import qualified Data.Text as T
import Network.Kafka (Kafka)
import qualified Network.Kafka as K
import qualified Network.Kafka.Producer as KW
import qualified Network.Kafka.Protocol as KP

indexEventsTopicName :: KP.TopicName
indexEventsTopicName = lookupTopic "indexevents"

readIndexEvents :: (Binary a, Kafka k) => KP.TopicName -> KP.Offset -> k [a]
readIndexEvents topicName = readIndexEventsFromTopic topicName

readIndexEventsFromTopic :: (Binary a, Kafka k) => KP.TopicName -> KP.Offset -> k [a]
readIndexEventsFromTopic topic offset = setDefaultKafkaState >> map (decode . L.fromStrict) <$> fetchBytes topic offset

produce :: (Binary a, Kafka k) => [a] -> k [KP.ProduceResponse]
produce events = do
  results <-
    KW.produceMessagesAsSingletonSets $
      (K.TopicAndMessage indexEventsTopicName . KW.makeMessage . L.toStrict . encode) <$> events
  liftIO $ mapM_ parseKafkaResponse results
  return results

consume :: (Binary a, MonadLogger m, HasKafka m) =>
           Text -> KP.ConsumerGroup -> KP.TopicName -> ([a] -> m ()) -> m ()
consume name consumerGroup topicName f = 
  forever $ do
    $logInfoS name "About to fetch blocks"
    (offset, idxEvents) <- fetch consumerGroup topicName
    $logInfoS name . T.pack $ "Fetched " ++ show (length idxEvents) ++ " events starting from " ++ show offset
    f idxEvents
    let nextOffset' = offset + fromIntegral (length idxEvents)
    setKafkaCheckpoint consumerGroup topicName nextOffset' ""


getKafkaCheckpoint :: (MonadLogger m, HasKafka m) =>
                      KP.ConsumerGroup -> KP.TopicName -> m Offset
getKafkaCheckpoint consumerGroup topicName =
  execKafka (fetchSingleOffset consumerGroup topicName 0) >>= \case
    Left UnknownTopicOrPartition -> setKafkaCheckpoint consumerGroup topicName 0 "" >> getKafkaCheckpoint consumerGroup topicName
    Left err -> error $ "Unexpected response when fetching offset for " ++ show consumerGroup ++ ": " ++ show err
    Right r -> pure $ fst r

setKafkaCheckpoint :: (MonadLogger m, HasKafka m) =>
                      KP.ConsumerGroup -> KP.TopicName -> Offset -> Metadata -> m ()
setKafkaCheckpoint consumerGroup topicName ofs md = do
  $logInfoS "setKafkaCheckpoint" . T.pack $ "Setting checkpoint to " ++ show ofs
  op <- execKafka (setKafkaCheckpoint' consumerGroup topicName ofs md)
  case op of
    Left err -> error $ "Client error: " ++ show err
    Right _ -> return ()

setKafkaCheckpoint' :: Kafka k => KP.ConsumerGroup -> KP.TopicName -> Offset -> Metadata -> k (Either KafkaError ())
setKafkaCheckpoint' consumerGroup targetTopicName offset md = commitSingleOffset consumerGroup targetTopicName 0 `flip` md $ offset

fetch :: (Binary a, MonadLogger m, HasKafka m) =>
         KP.ConsumerGroup -> KP.TopicName -> m (Offset, [a])
fetch consumerGroup topicName = do
  ofs <- getKafkaCheckpoint consumerGroup topicName
  evs <- execKafka $ readIndexEvents topicName ofs
  return (ofs, evs)
