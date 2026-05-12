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

module Control.Monad.Composable.Streaming (
  module Control.Monad.Composable.Streaming.RabbitMQ
) where

import Control.Monad.Composable.Streaming.RabbitMQ
