{-# LANGUAGE OverloadedStrings #-}

-- | Docker configuration for the message broker.
-- This module re-exports the config for the currently selected backend.
-- Change the import below to switch brokers (must match Streaming.hs).
module Control.Monad.Composable.Streaming.DockerConfig (
  BrokerConfig(..),
  brokerConfig,
  brokerVolumeDirs
) where

-- Change this import to switch message broker SERVER:
--   Kafka:    import Control.Monad.Composable.Streaming.DockerConfig.Kafka
--             (use with kafka-monad or streaming-kafka-hw client)
--   Redpanda: import Control.Monad.Composable.Streaming.DockerConfig.Redpanda
--             (use with streaming-kafka-hw or streaming-redpanda client)
--   RabbitMQ: import Control.Monad.Composable.Streaming.DockerConfig.RabbitMQ
--             (use with streaming-rabbitmq client)
import Control.Monad.Composable.Streaming.DockerConfig.Kafka
