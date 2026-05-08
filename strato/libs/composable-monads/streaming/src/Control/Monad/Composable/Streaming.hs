-- | Umbrella module for message streaming.
-- 
-- This module re-exports the active streaming backend.
-- To switch backends, change the dependency in package.yaml.
--
-- Available backends:
--   * kafka-monad (current)
--   * rabbitmq-monad (future)
--   * redpanda-monad (future)

module Control.Monad.Composable.Streaming (
  module Control.Monad.Composable.Kafka
) where

import Control.Monad.Composable.Kafka
