{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecursiveDo #-}

module Components.NodeCard where

import Reflex.Dom
import qualified Data.Text as T
import qualified Types.State as TS

data NodeCardConfig = NodeCardConfig
  { nodeId :: T.Text
  , nodeUptime :: Double
  , nodeVersion :: T.Text
  , nodeStatus :: TS.NodeStatus
  } deriving (Show, Eq)

nodeCard :: MonadWidget t m => NodeCardConfig -> m ()
nodeCard config = do
  elClass "div" "node-card" $ do
    elClass "div" "node-card-header" $ do
      elClass "i" "fa fa-server" blank
      el "h3" $ text "Node Information"
    
    elClass "div" "node-card-content" $ do
      infoRow "Node ID" (Components.NodeCard.nodeId config)
      infoRow "Uptime" (T.pack $ show (Components.NodeCard.nodeUptime config) <> " hours")
      infoRow "Version" (Components.NodeCard.nodeVersion config)
      infoRow "Status" (T.pack $ show (Components.NodeCard.nodeStatus config))
  where
    infoRow label val = do
      elClass "div" "info-row" $ do
        elClass "span" "label" $ text label
        elClass "span" "value" $ text val 