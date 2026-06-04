{-# LANGUAGE OverloadedStrings #-}

-- | Docker configuration for JLog (embedded - no container needed)
module Control.Monad.Composable.Streaming.JLog.DockerConfig (
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

-- | JLog is embedded - no Docker container needed.
-- This config signals to strato-init that no streaming container should be created.
brokerConfig :: BrokerConfig
brokerConfig = BrokerConfig
  { bcImage = ""  -- Empty image = no container
  , bcHost = "./jlog"  -- File path for JLog directories (relative to working dir)
  , bcEnvironment = Nothing
  , bcEntrypoint = Nothing
  , bcCommand = Nothing
  , bcHealthcheckTest = []
  , bcVolumes = []  -- No Docker volumes needed (embedded)
  , bcPort = 0  -- No network port
  , bcNeedsUserGid = False
  }

brokerVolumeDirs :: [FilePath]
brokerVolumeDirs = ["jlog"]
