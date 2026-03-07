{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Strato.StateDiff.Kafka
  (
    assertStateDiffTopicCreation,
  )
where

import Control.Monad.Composable.Kafka

stateDiffTopicName :: TopicName
stateDiffTopicName = "statediff"

assertStateDiffTopicCreation :: HasKafka k => k ()
assertStateDiffTopicCreation = createTopic stateDiffTopicName
