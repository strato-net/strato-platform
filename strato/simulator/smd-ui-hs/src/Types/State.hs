{-# LANGUAGE OverloadedStrings #-}

module Types.State where

import qualified Data.Text as T

-- Main application state
data AppState = AppState
  { nodeState :: NodeState
  , systemMetrics :: SystemMetrics
  , healthStatus :: HealthStatus
  , networkStats :: NetworkStats
  , syncStatus :: Bool
  }

-- Node state
data NodeState = NodeState
  { nodeId :: T.Text
  , nodeUptime :: Double
  , nodeVersion :: T.Text
  , nodeStatus :: NodeStatus
  }

-- Node status
data NodeStatus
  = NodeActive
  | NodeInactive
  | NodeSyncing
  deriving (Eq, Show)

-- System metrics
data SystemMetrics = SystemMetrics
  { cpuUsage :: Double
  , memoryUsage :: Double
  , diskUsage :: Double
  , networkUsage :: Double
  }

-- Health status
data HealthStatus = HealthStatus
  { isHealthy :: Bool
  , healthIssues :: [T.Text]
  , healthMessage :: T.Text
  }

-- Network statistics
data NetworkStats = NetworkStats
  { totalNodes :: Int
  , connectedNodes :: Int
  , networkLatency :: Double
  , networkThroughput :: Double
  }

-- Transaction data
data Transaction = Transaction
  { txHash :: T.Text
  , txFrom :: T.Text
  , txTo :: T.Text
  , txValue :: Double
  , txTimestamp :: Double
  , txStatus :: TransactionStatus
  }

-- Transaction status
data TransactionStatus
  = TxPending
  | TxSuccess
  | TxFailed
  deriving (Eq, Show)

-- Validator data
data Validator = Validator
  { validatorAddress :: T.Text
  , validatorStake :: Double
  , validatorStatus :: ValidatorStatus
  }

-- Validator status
data ValidatorStatus
  = ValidatorActive
  | ValidatorInactive
  | ValidatorSlashed
  deriving (Eq, Show)

-- Default state
defaultAppState :: AppState
defaultAppState = AppState
  { nodeState = defaultNodeState
  , systemMetrics = defaultSystemMetrics
  , healthStatus = defaultHealthStatus
  , networkStats = defaultNetworkStats
  , syncStatus = False
  }

defaultNodeState :: NodeState
defaultNodeState = NodeState
  { nodeId = ""
  , nodeUptime = 0
  , nodeVersion = ""
  , nodeStatus = NodeInactive
  }

defaultSystemMetrics :: SystemMetrics
defaultSystemMetrics = SystemMetrics
  { cpuUsage = 0
  , memoryUsage = 0
  , diskUsage = 0
  , networkUsage = 0
  }

defaultHealthStatus :: HealthStatus
defaultHealthStatus = HealthStatus
  { isHealthy = False
  , healthIssues = []
  , healthMessage = "Initializing..."
  }

defaultNetworkStats :: NetworkStats
defaultNetworkStats = NetworkStats
  { totalNodes = 0
  , connectedNodes = 0
  , networkLatency = 0
  , networkThroughput = 0
  } 