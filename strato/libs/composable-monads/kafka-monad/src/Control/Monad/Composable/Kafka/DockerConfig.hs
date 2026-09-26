{-# LANGUAGE OverloadedStrings #-}

-- | Docker configuration for Apache Kafka
module Control.Monad.Composable.Kafka.DockerConfig (
  BrokerConfig(..),
  brokerConfig,
  brokerVolumeDirs
) where

import Data.Map (Map)
import qualified Data.Map as Map

data BrokerConfig = BrokerConfig
  { bcImage :: String
  , bcHost :: String  -- Hostname or path for embedded backends
  , bcEnvironment :: Maybe (Map String String)
  , bcEntrypoint :: Maybe [String]
  , bcCommand :: Maybe [String]
  , bcHealthcheckTest :: [String]
  , bcVolumes :: [String]
  , bcPort :: Int
  , bcNeedsUserGid :: Bool
  }

brokerConfig :: BrokerConfig
brokerConfig = BrokerConfig
  { bcImage = "apache/kafka:3.9.2"
  , bcHost = "localhost"  -- Default host for processes connecting to exposed port
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
      -- Largest record the broker will accept. Raised from 2500000 after helium
      -- block 595971, where two ~655KB contract deploys produced a 2,720,457 B
      -- CodeCollectionAdded VMEvent; the broker refused it and the uncaught
      -- rejection took every validator down. That record is a single
      -- indivisible event on a topic whose producer still throws, so this limit
      -- -- not any resilience in the producer -- is what keeps such a block
      -- from halting the chain. Note the effective ceiling appears to be about
      -- HALF this value, so budget accordingly.
      --
      -- Upper bound, do not exceed: milena's 'defaultMaxBytes' fetch ceiling.
      -- It consumes with Fetch v0, which returns *nothing* for a partition
      -- whose next record is larger than the request's maxBytes, so a record
      -- the broker accepts but the client cannot fetch stalls the consumer at
      -- that offset silently and permanently -- a worse failure than the
      -- rejection this raise is meant to avoid.
      , ("KAFKA_MAX_REQUEST_SIZE", "8000000")
      , ("KAFKA_MESSAGE_MAX_BYTES", "8000000")
      , ("KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR", "1")
      , ("KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR", "1")
      , ("KAFKA_TRANSACTION_STATE_LOG_MIN_ISR", "1")
      ]
  , bcEntrypoint = Just ["/bin/sh", "-c"]
  -- chmod so the host user's strato-logrotate can rotate (truncate) the log:
  -- this container runs as the image's own user, not as the host uid.
  , bcCommand = Just ["touch /logs/kafka.log && chmod 666 /logs/kafka.log || true; exec /__cacert_entrypoint.sh /etc/kafka/docker/run >> /logs/kafka.log 2>&1"]
  , bcHealthcheckTest = ["CMD-SHELL", "/opt/kafka/bin/kafka-broker-api-versions.sh --bootstrap-server localhost:9092 || exit 1"]
  , bcVolumes = ["./logs:/logs", "./kafka:/kafka"]
  , bcPort = 9092
  , bcNeedsUserGid = False
  }

brokerVolumeDirs :: [FilePath]
brokerVolumeDirs = ["kafka"]
