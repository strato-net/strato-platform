{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Strato.Discovery.Metrics
  ( recordStateChange,
    ActivityState (..),
    getNumPeersMem,
  )
where

import Control.Monad.IO.Class
import Prometheus

data ActivityState = Inactive | Active deriving (Eq, Show, Enum, Ord)

numPeers :: Gauge
numPeers =
  unsafeRegister
    . gauge
    $ Info "disc_num_peers" "Number of active peers at any given time"

recordStateChange :: MonadMonitor m => ActivityState -> m ()
recordStateChange = \case
  Inactive -> subGauge numPeers 1
  Active -> addGauge numPeers 1

getNumPeersMem :: MonadIO m => m Int
getNumPeersMem = floor <$> getGauge numPeers
