{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module State.Store where

import Reflex.Dom.Core
import Types.State

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