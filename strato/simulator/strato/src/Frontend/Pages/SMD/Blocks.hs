{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.Pages.SMD.Blocks where

import Frontend.Components.NumberCard
import Frontend.Components.BarGraph
import qualified Frontend.Types.State as TS
import Reflex.Dom.Core

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
