-- | Umbrella module for message streaming.
-- 
-- This module re-exports the active streaming client library.
-- To switch, change the import below AND the dependency in package.yaml.
--
-- Available client libraries:
--   kafka-monad        -> import Control.Monad.Composable.Kafka
--   streaming-kafka-hw -> import Control.Monad.Composable.Streaming.Kafka
--   streaming-redpanda -> import Control.Monad.Composable.Streaming.Redpanda
--   streaming-rabbitmq -> import Control.Monad.Composable.Streaming.RabbitMQ
--   streaming-jlog     -> import Control.Monad.Composable.Streaming.JLog (embedded, no server)

module Control.Monad.Composable.Streaming (
  module Control.Monad.Composable.Streaming.JLog
) where

import Control.Monad.Composable.Streaming.JLog
