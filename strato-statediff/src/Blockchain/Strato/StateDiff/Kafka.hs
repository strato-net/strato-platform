module Blockchain.Strato.StateDiff.Kafka
    ( stateDiffTopicName
    , assertTopicCreation
    , readStateDiffEvents
    , writeStateDiffEvents
    , writeStateDiffs
    ) where

import qualified Network.Kafka                     as K
import qualified Network.Kafka.Protocol            as KP

import           Blockchain.KafkaTopics            (lookupTopic)

import           Blockchain.Strato.StateDiff
import           Blockchain.Strato.StateDiff.Event

stateDiffTopicName :: KP.TopicName
stateDiffTopicName = lookupTopic "statediff"

assertTopicCreation :: K.Kafka k => k ()
assertTopicCreation = K.updateMetadata stateDiffTopicName

readStateDiffEvents :: K.Kafka k => KP.Offset -> k [StateDiffKafkaEvent]
readStateDiffEvents = undefined

writeStateDiffEvents :: K.Kafka k => [StateDiffEvent] -> k ()
writeStateDiffEvents = undefined

writeStateDiffs :: K.Kafka k => [StateDiff] -> k ()
writeStateDiffs = undefined
