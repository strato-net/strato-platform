module Blockchain.Strato.StateDiff.Kafka
    ( stateDiffTopicName
    , assertTopicCreation
    , readStateDiffEvents
    , writeStateDiffEvents
    , writeStateDiffs
    ) where

import           Data.Aeson
import qualified Data.ByteString.Lazy              as L
import qualified Network.Kafka                     as K
import qualified Network.Kafka.Producer            as KW
import qualified Network.Kafka.Protocol            as KP

import           Blockchain.KafkaTopics            (lookupTopic)

import           Blockchain.Strato.StateDiff
import           Blockchain.Strato.StateDiff.Event
import           Blockchain.Stream.Raw             (fetchBytes, setDefaultKafkaState)

stateDiffTopicName :: KP.TopicName
stateDiffTopicName = lookupTopic "statediff"

assertTopicCreation :: K.Kafka k => k ()
assertTopicCreation = K.updateMetadata stateDiffTopicName

readStateDiffEvents :: K.Kafka k => KP.Offset -> k [StateDiffKafkaEvent]
-- readStateDiffEvents = readStateDiffEventsFromTopic stateDiffTopicName
readStateDiffEvents = undefined

-- readStateDiffEventsFromTopic :: K.Kafka k => KP.TopicName -> KP.Offset -> k [StateDiffKafkaEvent]
-- readStateDiffEventsFromTopic topic offset = setDefaultKafkaState >> map (decode . L.fromStrict) <$> fetchBytes topic offset

writeStateDiffEvents :: K.Kafka k => [StateDiffEvent] -> k [KP.ProduceResponse]
writeStateDiffEvents events = KW.produceMessages $
  (K.TopicAndMessage stateDiffTopicName . KW.makeMessage . L.toStrict . encode) <$> events

writeStateDiffs :: K.Kafka k => [StateDiff] -> k [KP.ProduceResponse]
writeStateDiffs events = KW.produceMessages $
  (K.TopicAndMessage stateDiffTopicName . KW.makeMessage . L.toStrict . encode) <$> events
