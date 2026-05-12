{-# LANGUAGE OverloadedStrings #-}

-- | Docker configuration for the message broker.
-- This module re-exports the config for the currently selected backend.
-- The import is determined by which backend the streaming package depends on.
module Control.Monad.Composable.Streaming.DockerConfig (
  BrokerConfig(..),
  brokerConfig,
  brokerVolumeDirs
) where

-- Re-export from the active backend's DockerConfig.
-- This import must match the backend dependency in package.yaml:
--   kafka-monad       -> Control.Monad.Composable.Kafka.DockerConfig
--   streaming-kafka-hw -> Control.Monad.Composable.Streaming.Kafka.DockerConfig
--   streaming-rabbitmq -> Control.Monad.Composable.Streaming.RabbitMQ.DockerConfig
import Control.Monad.Composable.Streaming.RabbitMQ.DockerConfig
