{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.Types.State where

import qualified Data.Map.Strict as M
import qualified Data.Text as T
import Reflex.Dom.Core

-- Main application state
data AppState = AppState
  { nodeState :: NodeState
  , systemMetrics :: SystemMetrics
  , healthStatus :: HealthStatus
  , networkStats :: NetworkStats
  , syncStatus :: Bool
  }

-- Node status
data NodeStatus
  = NodeActive
  | NodeInactive
  | NodeSyncing
  deriving (Eq, Show)

-- in Types.State
data PeerInfo = PeerInfo
  { pubkey   :: T.Text
  , host     :: T.Text
  , tcpPort  :: Int
  }

type PeerMap = M.Map T.Text PeerInfo -- peerId -> PeerInfo

-- updated NodeState
data NodeState = NodeState
  { nodeId :: T.Text
  , nodeUptime :: Double
  , nodeVersion :: T.Text
  , nodeStatus :: NodeStatus
  , nodePeers :: PeerMap
  }

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
  , nodePeers = M.empty
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

-- State manager function
stateManager :: MonadWidget t m => m (Dynamic t AppState)
stateManager = do
  -- Initialize with default state
  holdDyn initialState never
  where
    initialState = AppState
      { nodeState = NodeState
          { nodeId = "node-1"
          , nodeUptime = 3600
          , nodeVersion = "1.0.0"
          , nodeStatus = NodeActive
          , nodePeers = M.fromList
             [ ("node-2", PeerInfo "abcd" "node2.mercata.blockapps.net" 30303)
             , ("node-3", PeerInfo "efgh" "node3.mercata.blockapps.net" 30303)
             ]
          }
      , systemMetrics = SystemMetrics
          { cpuUsage = 45.5
          , memoryUsage = 60.2
          , diskUsage = 75.8
          , networkUsage = 0.0
          }
      , healthStatus = HealthStatus
          { isHealthy = True
          , healthIssues = []
          , healthMessage = "System is healthy"
          }
      , networkStats = NetworkStats
          { totalNodes = 100
          , connectedNodes = 95
          , networkLatency = 50
          , networkThroughput = 1000
          }
      , syncStatus = True
      }