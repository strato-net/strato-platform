{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Routing where

import Reflex.Dom.Core
import qualified Data.Text as T
import qualified Data.Map as Map
import qualified Types.State as TS
import Components.NumberCard
import Components.TransactionList
import Components.BarGraph
import Components.NodeCard
import Components.PieChart
import Components.ValidatorsCard

-- Route type representing different pages
data Route
  = Dashboard
  | Accounts
  | Contracts
  | Blocks
  deriving (Eq, Show)

-- Route configuration
routeConfig :: Map.Map T.Text Route
routeConfig = Map.fromList
  [ ("/", Dashboard)
  , ("/accounts", Accounts)
  , ("/contracts", Contracts)
  , ("/blocks", Blocks)
  ]

-- Router widget that handles navigation
router :: (MonadWidget t m) => Dynamic t Route -> Dynamic t TS.AppState -> m ()
router currentRoute stateDyn = do
  el "div" $ do
    -- Navigation bar
    navBar currentRoute
    
    -- Main content area
    el "main" $ do
      dyn_ $ ffor currentRoute $ \route -> case route of
        Dashboard -> dashboardWidget stateDyn
        Accounts -> accountsWidget stateDyn
        Contracts -> contractsWidget stateDyn
        Blocks -> blocksWidget stateDyn

-- Navigation bar component
navBar :: (MonadWidget t m) => Dynamic t Route -> m ()
navBar currentRoute = do
  el "nav" $ do
    el "ul" $ do
      navItem currentRoute "/" "Dashboard"
      navItem currentRoute "/accounts" "Accounts"
      navItem currentRoute "/contracts" "Contracts"
      navItem currentRoute "/blocks" "Blocks"

-- Navigation item component
navItem :: (MonadWidget t m) => Dynamic t Route -> T.Text -> T.Text -> m ()
navItem currentRoute path label = do
  let isActive = ffor currentRoute $ \route ->
        case Map.lookup path routeConfig of
          Just r -> r == route
          Nothing -> False
  
  elDynAttr "li" (ffor isActive $ \active ->
    if active
      then Map.singleton "class" "active"
      else Map.empty) $ do
    elAttr "a" (Map.singleton "href" path) $ text label

-- Dashboard widget
dashboardWidget :: (MonadWidget t m) => Dynamic t TS.AppState -> m ()
dashboardWidget stateDyn = do
  -- Node stats section
  el "div" $ do
    el "h2" $ text "Node Stats"
    el "div" $ do
      dyn_ $ ffor stateDyn $ \state -> do
        -- Node card
        nodeCard $ NodeCardConfig
          { nodeId = TS.nodeId (TS.nodeState state)
          , nodeUptime = TS.nodeUptime (TS.nodeState state)
          , nodeVersion = TS.nodeVersion (TS.nodeState state)
          , nodeStatus = TS.nodeStatus (TS.nodeState state)
          }
        
        -- System metrics
        el "div" $ do
          numberCard $ NumberCardConfig
            { number = T.pack $ show $ TS.cpuUsage (TS.systemMetrics state)
            , description = "CPU Usage"
            , iconClass = "cpu"
            , mode = "primary"
            }
          
          numberCard $ NumberCardConfig
            { number = T.pack $ show $ TS.memoryUsage (TS.systemMetrics state)
            , description = "Memory Usage"
            , iconClass = "memory"
            , mode = "primary"
            }
          
          numberCard $ NumberCardConfig
            { number = T.pack $ show $ TS.diskUsage (TS.systemMetrics state)
            , description = "Disk Usage"
            , iconClass = "disk"
            , mode = "primary"
            }
  
  -- Network stats section
  el "div" $ do
    el "h2" $ text "Network Stats"
    el "div" $ do
      dyn_ $ ffor stateDyn $ \state -> do
        -- Network metrics
        el "div" $ do
          numberCard $ NumberCardConfig
            { number = T.pack $ show $ TS.totalNodes (TS.networkStats state)
            , description = "Total Nodes"
            , iconClass = "nodes"
            , mode = "primary"
            }
          
          numberCard $ NumberCardConfig
            { number = T.pack $ show $ TS.connectedNodes (TS.networkStats state)
            , description = "Connected Nodes"
            , iconClass = "connected"
            , mode = "primary"
            }
        
        -- Network graphs
        el "div" $ do
          barGraph $ BarGraphConfig
            { bgData = [TS.networkLatency (TS.networkStats state)]
            , bgLabel = "Network Latency"
            , bgIdentifier = "latency"
            , bgUnits = Just "ms"
            }
  
  -- Validators section
  el "div" $ do
    el "h2" $ text "Validators"
    el "div" $ do
      dyn_ $ ffor stateDyn $ \_ -> do
        validatorsCard $ ValidatorsCardConfig
          { vcValidators = []  -- TODO: Add validator data
          , vcTotalStake = 0   -- TODO: Add total stake
          }
  
  -- Transactions section
  el "div" $ do
    el "h2" $ text "Recent Transactions"
    el "div" $ do
      dyn_ $ ffor stateDyn $ \_ -> do
        transactionList $ TransactionListConfig
          { tlcTransactions = []  -- TODO: Add transaction data
          , tlcLimit = 10
          } 

-- Accounts page widget
accountsWidget :: (MonadWidget t m) => Dynamic t TS.AppState -> m ()
accountsWidget stateDyn = do
  el "div" $ do
    el "h1" $ text "Accounts"
    
    -- Account statistics
    el "div" $ do
      el "h2" $ text "Account Statistics"
      dyn_ $ ffor stateDyn $ \_ -> do
        el "div" $ do
          numberCard $ NumberCardConfig
            { number = "0"  -- TODO: Add total accounts count
            , description = "Total Accounts"
            , iconClass = "account"
            , mode = "primary"
            }
          
          numberCard $ NumberCardConfig
            { number = "0"  -- TODO: Add active accounts count
            , description = "Active Accounts"
            , iconClass = "active"
            , mode = "secondary"
            }
    
    -- Account distribution
    el "div" $ do
      el "h2" $ text "Account Distribution"
      dyn_ $ ffor stateDyn $ \_ -> do
        pieChart $ PieChartConfig
          { pcData = [PieData 60 "Regular" "#28a745"
                     , PieData 30 "Contract" "#007bff"
                     , PieData 10 "System" "#6c757d"]
          , pcTitle = "Account Types"
          }
    
    -- Recent account activity
    el "div" $ do
      el "h2" $ text "Recent Account Activity"
      dyn_ $ ffor stateDyn $ \_ -> do
        transactionList $ TransactionListConfig
          { tlcTransactions = []  -- TODO: Add account transactions
          , tlcLimit = 10
          }

-- Contracts page widget
contractsWidget :: (MonadWidget t m) => Dynamic t TS.AppState -> m ()
contractsWidget stateDyn = do
  el "div" $ do
    el "h1" $ text "Contracts"
    
    -- Contract statistics
    el "div" $ do
      el "h2" $ text "Contract Statistics"
      dyn_ $ ffor stateDyn $ \_ -> do
        el "div" $ do
          numberCard $ NumberCardConfig
            { number = "0"  -- TODO: Add total contracts count
            , description = "Total Contracts"
            , iconClass = "contract"
            , mode = "primary"
            }
          
          numberCard $ NumberCardConfig
            { number = "0"  -- TODO: Add active contracts count
            , description = "Active Contracts"
            , iconClass = "active"
            , mode = "secondary"
            }
    
    -- Contract usage
    el "div" $ do
      el "h2" $ text "Contract Usage"
      dyn_ $ ffor stateDyn $ \_ -> do
        barGraph $ BarGraphConfig
          { bgData = [100, 200, 150, 300, 250]  -- TODO: Add real usage data
          , bgLabel = "Contract Calls (Last 5 Blocks)"
          , bgIdentifier = "contract-usage"
          , bgUnits = Just "calls"
          }
    
    -- Recent contract activity
    el "div" $ do
      el "h2" $ text "Recent Contract Activity"
      dyn_ $ ffor stateDyn $ \_ -> do
        transactionList $ TransactionListConfig
          { tlcTransactions = []  -- TODO: Add contract transactions
          , tlcLimit = 10
          }

-- Blocks page widget
blocksWidget :: (MonadWidget t m) => Dynamic t TS.AppState -> m ()
blocksWidget stateDyn = do
  el "div" $ do
    el "h1" $ text "Blocks"
    
    -- Block statistics
    el "div" $ do
      el "h2" $ text "Block Statistics"
      dyn_ $ ffor stateDyn $ \_ -> do
        el "div" $ do
          numberCard $ NumberCardConfig
            { number = "0"  -- TODO: Add current block height
            , description = "Current Block Height"
            , iconClass = "block"
            , mode = "primary"
            }
          
          numberCard $ NumberCardConfig
            { number = "0"  -- TODO: Add average block time
            , description = "Average Block Time"
            , iconClass = "time"
            , mode = "secondary"
            }
    
    -- Block size distribution
    el "div" $ do
      el "h2" $ text "Block Size Distribution"
      dyn_ $ ffor stateDyn $ \_ -> do
        barGraph $ BarGraphConfig
          { bgData = [1000, 1200, 800, 1500, 900]  -- TODO: Add real block sizes
          , bgLabel = "Block Sizes (Last 5 Blocks)"
          , bgIdentifier = "block-sizes"
          , bgUnits = Just "KB"
          }
    
    -- Recent blocks
    el "div" $ do
      el "h2" $ text "Recent Blocks"
      dyn_ $ ffor stateDyn $ \_ -> do
        el "table" $ do
          el "thead" $ do
            el "tr" $ do
              el "th" $ text "Height"
              el "th" $ text "Hash"
              el "th" $ text "Transactions"
              el "th" $ text "Time"
          el "tbody" $ do
            el "tr" $ do
              el "td" $ text "No blocks available"
            -- TODO: Add recent blocks data 