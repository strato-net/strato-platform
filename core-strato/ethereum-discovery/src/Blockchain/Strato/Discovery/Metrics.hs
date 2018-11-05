{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
module Blockchain.Strato.Discovery.Metrics
  ( recordStateChange
  , ActivityState(..)
  , getNumPeers
  ) where

import Control.Monad.IO.Class
import Prometheus

data ActivityState = Unactive | Active deriving (Eq, Show, Enum, Ord)

numPeers :: Gauge
numPeers = unsafeRegister
         . gauge
         $ Info "disc_num_peers" "Number of active peers at any given time"

recordStateChange :: MonadMonitor m => ActivityState -> m ()
recordStateChange = \case
  Unactive -> subGauge numPeers 1
  Active -> addGauge numPeers 1

getNumPeers :: MonadIO m => m Int
getNumPeers = floor <$> getGauge numPeers
