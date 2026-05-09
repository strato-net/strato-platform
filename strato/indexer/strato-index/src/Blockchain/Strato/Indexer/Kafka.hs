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

import Control.Monad.Composable.Streaming
import Data.Binary

indexEventsTopicName :: TopicName
indexEventsTopicName = "indexevents"

produceIndexEvents :: (Binary a, HasStreaming m) =>
                      [a] -> m [ProduceResponse]
produceIndexEvents = produceItems indexEventsTopicName
