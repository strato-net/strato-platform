module Blockchain.Strato.StateDiff.Kafka
    ( indexEventsTopicName
    , assertTopicCreation
    ) where

indexEventsTopicName :: KP.TopicName
indexEventsTopicName = lookupTopic "indexevents"

assertTopicCreation :: K.Kafka k => k ()
assertTopicCreation = K.updateMetadata indexEventsTopicName