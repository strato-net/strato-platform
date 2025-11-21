{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.Pages.SMD.Users where

import Frontend.Components.NumberCard
import Frontend.Components.TransactionList
import Frontend.Components.PieChart
import qualified Frontend.Types.State as TS
import Reflex.Dom.Core

-- Users page widget
usersWidget :: (MonadWidget t m) => Dynamic t TS.AppState -> m ()
usersWidget stateDyn = do
  el "div" $ do
    el "h1" $ text "Users"

    -- User statistics
    el "div" $ do
      el "h2" $ text "User Statistics"
      dyn_ $ ffor stateDyn $ \_ -> do
        el "div" $ do
          numberCard $ NumberCardConfig
            { number = "0"  -- TODO: Add total users count
            , description = "Total Users"
            , iconClass = "user"
            , mode = "primary"
            }

          numberCard $ NumberCardConfig
            { number = "0"  -- TODO: Add active users count
            , description = "Active Users"
            , iconClass = "active"
            , mode = "secondary"
            }

    -- User distribution
    el "div" $ do
      el "h2" $ text "User Distribution"
      dyn_ $ ffor stateDyn $ \_ -> do
        pieChart $ PieChartConfig
          { pcData = [PieData 60 "Regular" "#28a745"
                     , PieData 30 "Contract" "#007bff"
                     , PieData 10 "System" "#6c757d"]
          , pcTitle = "User Types"
          }

    -- Recent user activity
    el "div" $ do
      el "h2" $ text "Recent User Activity"
      dyn_ $ ffor stateDyn $ \_ -> do
        transactionList $ TransactionListConfig
          { tlcTransactions = []  -- TODO: Add user transactions
          , tlcLimit = 10
          }