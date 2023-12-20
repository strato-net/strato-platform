{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Strato.Indexer.Kafka
  ( indexEventsTopicName,
    produceIndexEvents,
    consume
  )
where

import Blockchain.KafkaTopics (lookupTopic)
import Control.Monad.Composable.Kafka
import Data.Binary
import qualified Network.Kafka.Protocol as KP

indexEventsTopicName :: KP.TopicName
indexEventsTopicName = lookupTopic "indexevents"

produceIndexEvents :: (Binary a, HasKafka m) =>
                      [a] -> m [KP.ProduceResponse]
produceIndexEvents = produceItems indexEventsTopicName
