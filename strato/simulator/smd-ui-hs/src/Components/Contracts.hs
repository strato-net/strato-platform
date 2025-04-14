{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Components.Contracts where

import Reflex.Dom.Core
import qualified Types.State as TS
import Components.NumberCard
import Components.TransactionList
import Components.BarGraph

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