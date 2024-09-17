
module Blockchain.Strato.StateDiff.Kafka
  ( 
    assertStateDiffTopicCreation,
  )
where

import Blockchain.KafkaTopics (lookupTopic)
import Control.Monad.Composable.Kafka

stateDiffTopicName :: TopicName
stateDiffTopicName = lookupTopic "statediff"

assertStateDiffTopicCreation :: HasKafka k => k ()
assertStateDiffTopicCreation = createTopic stateDiffTopicName
