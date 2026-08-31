{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Strato.Indexer.Kafka
  ( indexEventsTopicName,
    produceIndexEvents,
    produceEncodedIndexEvents,
    consume
  )
where

import Control.Monad.Composable.Streaming
import Data.Binary
import qualified Data.ByteString as B

indexEventsTopicName :: TopicName
indexEventsTopicName = "indexevents"

produceIndexEvents :: (Binary a, HasStreaming m) =>
                      [a] -> m [ProduceResponse]
produceIndexEvents = produceItemsBatched indexEventsTopicName

produceEncodedIndexEvents :: HasStreaming m => [B.ByteString] -> m [ProduceResponse]
produceEncodedIndexEvents = produceEncodedItemsBatched indexEventsTopicName
