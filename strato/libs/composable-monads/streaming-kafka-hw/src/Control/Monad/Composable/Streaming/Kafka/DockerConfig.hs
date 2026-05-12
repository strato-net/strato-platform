{-# LANGUAGE OverloadedStrings #-}

-- | Docker configuration for Redpanda (Kafka-compatible)
-- Used with streaming-kafka-hw since Redpanda speaks the Kafka protocol
module Control.Monad.Composable.Streaming.Kafka.DockerConfig (
  BrokerConfig(..),
  brokerConfig,
  brokerVolumeDirs
) where

import Data.Map (Map)

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
  { bcImage = "redpandadata/redpanda:v24.1.1"
  , bcHost = "streaming"  -- Docker container name
  , bcEnvironment = Nothing
  , bcEntrypoint = Just ["/bin/sh", "-c"]
  , bcCommand = Just ["rpk redpanda start --smp=1 --memory=1G --overprovisioned --kafka-addr=PLAINTEXT://0.0.0.0:9092 --advertise-kafka-addr=PLAINTEXT://localhost:9092 --rpc-addr=0.0.0.0:33145 --advertise-rpc-addr=localhost:33145 >> /logs/kafka.log 2>&1"]
  , bcHealthcheckTest = ["CMD-SHELL", "rpk cluster health | grep -q 'Healthy:.*true' || exit 1"]
  , bcVolumes = ["./logs:/logs", "./redpanda/data:/var/lib/redpanda/data", "./redpanda/config:/etc/redpanda"]
  , bcPort = 9092
  , bcNeedsUserGid = True
  }

brokerVolumeDirs :: [FilePath]
brokerVolumeDirs = ["redpanda/data", "redpanda/config"]
