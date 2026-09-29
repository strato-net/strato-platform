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

-- | Publish index events, returning a description of any the broker refused.
-- An empty list means they all landed.
--
-- These events exist only to feed the indexer (Postgres/Cirrus). Nothing in
-- consensus reads the topic back, so a refused record costs a resync, never
-- correctness -- and it must never be able to stop block application. It could
-- before: the produce simply threw. At helium block 595971 an oversized record
-- killed vm-runner on every validator at once; that one was a @CodeCollectionAdded@
-- on @vmevents@ rather than an index event, but the block's @RanBlock@ was over
-- the ceiling too and would have done the same had it been reached first.
-- Callers are expected to log whatever comes back and carry on.
produceIndexEvents :: (Binary a, HasStreaming m) => [a] -> m [String]
produceIndexEvents = produceItemsBestEffort indexEventsTopicName
