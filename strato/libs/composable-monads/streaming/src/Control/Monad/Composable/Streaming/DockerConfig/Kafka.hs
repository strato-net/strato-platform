{-# LANGUAGE OverloadedStrings #-}

-- | Docker configuration for Apache Kafka
module Control.Monad.Composable.Streaming.DockerConfig.Kafka (
  BrokerConfig(..),
  brokerConfig,
  brokerVolumeDirs
) where

import Data.Map (Map)
import qualified Data.Map as Map

data BrokerConfig = BrokerConfig
  { bcImage :: String
  , bcEnvironment :: Maybe (Map String String)
  , bcEntrypoint :: Maybe [String]
  , bcCommand :: Maybe [String]
  , bcHealthcheckTest :: [String]
  , bcVolumes :: [String]
  , bcNeedsUserGid :: Bool
  }

brokerConfig :: BrokerConfig
brokerConfig = BrokerConfig
  { bcImage = "apache/kafka:3.9.2"
  , bcEnvironment = Just $ Map.fromList
      [ ("KAFKA_NODE_ID", "1")
      , ("KAFKA_PROCESS_ROLES", "broker,controller")
      , ("KAFKA_LISTENERS", "PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:9093")
      , ("KAFKA_ADVERTISED_LISTENERS", "PLAINTEXT://localhost:9092")
      , ("KAFKA_CONTROLLER_LISTENER_NAMES", "CONTROLLER")
      , ("KAFKA_LISTENER_SECURITY_PROTOCOL_MAP", "CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT")
      , ("KAFKA_CONTROLLER_QUORUM_VOTERS", "1@localhost:9093")
      , ("KAFKA_LOG_DIRS", "/kafka/kafka-logs")
      , ("KAFKA_DELETE_TOPIC_ENABLE", "true")
      , ("KAFKA_LOG_CLEANER_ENABLE", "true")
      , ("KAFKA_LOG_RETENTION_HOURS", "168")
      , ("KAFKA_OFFSET_METADATA_MAX_BYTES", "1048576")
      , ("KAFKA_OFFSETS_RETENTION_MINUTES", "2147483647")
      , ("KAFKA_MAX_REQUEST_SIZE", "2500000")
      , ("KAFKA_MESSAGE_MAX_BYTES", "2500000")
      , ("KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR", "1")
      , ("KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR", "1")
      , ("KAFKA_TRANSACTION_STATE_LOG_MIN_ISR", "1")
      ]
  , bcEntrypoint = Just ["/bin/sh", "-c"]
  , bcCommand = Just ["exec /__cacert_entrypoint.sh /etc/kafka/docker/run >> /logs/kafka.log 2>&1"]
  , bcHealthcheckTest = ["CMD-SHELL", "/opt/kafka/bin/kafka-broker-api-versions.sh --bootstrap-server localhost:9092 || exit 1"]
  , bcVolumes = ["./logs:/logs", "./kafka:/kafka"]
  , bcNeedsUserGid = False
  }

brokerVolumeDirs :: [FilePath]
brokerVolumeDirs = ["kafka"]
