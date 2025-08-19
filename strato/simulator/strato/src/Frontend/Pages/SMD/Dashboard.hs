{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecursiveDo #-}

module Frontend.Pages.SMD.Dashboard where

import Frontend.Components.NumberCard
import Frontend.Components.BarGraph
import Frontend.Components.PieChart
import Frontend.Components.TransactionList
import Frontend.Components.ValidatorsCard
import Frontend.Components.NodeCard
import qualified Frontend.Types.State as TS
import Reflex.Dom

dashboardWidget :: MonadWidget t m => Dynamic t TS.AppState -> m ()
dashboardWidget appStateDyn = do
  elClass "div" "container-fluid pt-dark" $ mdo

    -- Node Stats + System Metrics Heading
    elClass "div" "row d-flex align-items-center" $ do
      elClass "div" "col-sm-6 text-left" $ el "h3" $ text "Node Stats"
      elClass "div" "col-sm-6 text-right" $
        elClass "p" "text-right" $ text "System Metrics Loading..."

    spacerRow

    -- Number Cards Row
    elClass "div" "row" $ do
      col "col-sm-4" $ numberCard $ NumberCardConfig "Connected" "Uptime" "fa-check-circle" "success"
      col "col-sm-4" $ numberCard $ NumberCardConfig "23" "Users" "fa-users" "neutral"
      col "col-sm-4" $ numberCard $ NumberCardConfig "10" "Contracts" "fa-file-contract" "neutral"

    spacerRow

    -- Node Identity + NodeCard
    elClass "div" "row" $ dyn_ $ ffor appStateDyn $ \appState -> do
      col "col-sm-4" $ numberCard $ NumberCardConfig "Mercata Node" "Node ID" "fa-id-card" "neutral"
      col "col-sm-8" $ nodeCard $ TS.nodeState appState

    hrRow

    -- Network Stats Header
    elClass "div" "row" $ col "col-sm-9 text-left" $ el "h3" $ text "Network Stats"

    elClass "div" "row" $ do
      col "col-sm-3" $ do
        numberCard $ NumberCardConfig "Healthy" "Network" "fa-check-circle" "success"
        el "br" blank
        numberCard $ NumberCardConfig "1240" "Blocks" "fa-cube" "neutral"
      col "col-sm-3" $ validatorsCard exampleValidators
      col "col-sm-6" $ transactionList exampleTransactions

    hrRow

    -- Historical Stats
    elClass "div" "row" $ col "col-sm-9 text-left" $ el "h3" $ text "Historical Stats"

    elClass "div" "row" $ do
      col "col-sm-3" $
        barGraph $ BarGraphConfig [10, 25, 14, 6, 8, 13, 18] "Tx per Last 15 Blocks" "tx-bar" (Just "tx")
      col "col-sm-3" $
        pieChart $ PieChartConfig
          [ PieData 60 "Transfer" "#36A2EB"
          , PieData 40 "ContractCall" "#FF6384"
          ] "Tx Type Distribution"
      col "col-sm-3" $
        barGraph $ BarGraphConfig [6.2, 5.8, 7.0, 6.5, 6.9] "Block Intervals" "block-bar" (Just "s")

  where
    spacerRow = elClass "div" "row" $ elClass "div" "col-sm-12" $ el "br" blank
    hrRow = elClass "div" "row" $ elClass "div" "col-sm-12" $ el "hr" blank
    col cls = elClass "div" cls

    exampleTransactions = TransactionListConfig
      { tlcTransactions =
          [ TS.Transaction "0x1" "0xA" "0xB" 3.2 123 TS.TxSuccess
          , TS.Transaction "0x2" "0xC" "0xD" 1.5 124 TS.TxPending
          ]
      , tlcLimit = 10
      }

    exampleValidators = ValidatorsCardConfig
      { vcValidators =
          [ TS.Validator "0xVAL1" 50 TS.ValidatorActive
          , TS.Validator "0xVAL2" 30 TS.ValidatorInactive
          , TS.Validator "0xVAL3" 20 TS.ValidatorSlashed
          ]
      , vcTotalStake = 100
      }