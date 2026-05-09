{-# LANGUAGE OverloadedStrings #-}

-- | Docker configuration for Redpanda
module Control.Monad.Composable.Streaming.DockerConfig.Redpanda (
  BrokerConfig(..),
  brokerConfig,
  brokerVolumeDirs
) where

import Data.Map (Map)

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
  { bcImage = "redpandadata/redpanda:v24.1.1"
  , bcEnvironment = Nothing
  , bcEntrypoint = Just ["/bin/sh", "-c"]
  , bcCommand = Just ["rpk redpanda start --smp=1 --memory=1G --overprovisioned --kafka-addr=PLAINTEXT://0.0.0.0:9092 --advertise-kafka-addr=PLAINTEXT://localhost:9092 --rpc-addr=0.0.0.0:33145 --advertise-rpc-addr=localhost:33145 >> /logs/kafka.log 2>&1"]
  , bcHealthcheckTest = ["CMD-SHELL", "rpk cluster health | grep -q 'Healthy:.*true' || exit 1"]
  , bcVolumes = ["./logs:/logs", "./redpanda/data:/var/lib/redpanda/data", "./redpanda/config:/etc/redpanda"]
  , bcNeedsUserGid = True
  }

brokerVolumeDirs :: [FilePath]
brokerVolumeDirs = ["redpanda/data", "redpanda/config"]
