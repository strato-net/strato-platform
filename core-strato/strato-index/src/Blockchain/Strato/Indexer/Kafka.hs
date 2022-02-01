{-# LANGUAGE FlexibleContexts #-}
module Blockchain.Strato.Indexer.Kafka
    ( indexEventsTopicName
    , assertTopicCreation
    , readIndexEvents
    , readIndexEventsFromTopic
    , writeIndexEvents
    ) where


import           Data.Binary

import qualified Data.ByteString.Lazy            as L
import qualified Network.Kafka                   as K
import qualified Network.Kafka.Producer          as KW
import qualified Network.Kafka.Protocol          as KP

import           Blockchain.KafkaTopics          (lookupTopic)
import           Blockchain.Strato.Indexer.Model
import           Blockchain.Stream.Raw           (fetchBytes, setDefaultKafkaState)
import           Blockchain.MilenaTools

indexEventsTopicName :: KP.TopicName
indexEventsTopicName = lookupTopic "indexevents"

assertTopicCreation :: K.Kafka k => k ()
assertTopicCreation = K.updateMetadata indexEventsTopicName

readIndexEvents :: K.Kafka k => KP.Offset -> k [IndexEvent]
readIndexEvents = readIndexEventsFromTopic indexEventsTopicName

readIndexEventsFromTopic :: K.Kafka k => KP.TopicName -> KP.Offset -> k [IndexEvent]
readIndexEventsFromTopic topic offset = setDefaultKafkaState >> map (decode . L.fromStrict) <$> fetchBytes topic offset

writeIndexEvents :: K.Kafka k => [IndexEvent] -> k [KP.ProduceResponse]
writeIndexEvents events = do
  results <- KW.produceMessages $
    (K.TopicAndMessage indexEventsTopicName . KW.makeMessage . L.toStrict . encode) <$> events
  mapM_ parseKafkaResponse results
  return results
