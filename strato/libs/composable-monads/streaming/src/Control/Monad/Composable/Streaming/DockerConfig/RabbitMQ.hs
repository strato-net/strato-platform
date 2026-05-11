{-# LANGUAGE OverloadedStrings #-}

-- | Docker configuration for RabbitMQ
module Control.Monad.Composable.Streaming.DockerConfig.RabbitMQ (
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
  { bcImage = "rabbitmq:3.13-management"
  , bcEnvironment = Just $ Map.fromList
      [ ("RABBITMQ_DEFAULT_USER", "guest")
      , ("RABBITMQ_DEFAULT_PASS", "guest")
      ]
  , bcEntrypoint = Just ["/bin/sh", "-c"]
  , bcCommand = Just ["exec docker-entrypoint.sh rabbitmq-server >> /logs/rabbitmq.log 2>&1"]
  , bcHealthcheckTest = ["CMD-SHELL", "rabbitmq-diagnostics -q ping"]
  , bcVolumes = ["./logs:/logs", "./rabbitmq:/var/lib/rabbitmq"]
  , bcNeedsUserGid = True
  }

brokerVolumeDirs :: [FilePath]
brokerVolumeDirs = ["rabbitmq"]
