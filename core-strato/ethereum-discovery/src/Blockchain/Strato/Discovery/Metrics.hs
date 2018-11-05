{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
module Blockchain.Strato.Discovery.Metrics
  ( recordStateChange
  , ActivityState(..)
  , getSameTypeNumPeers
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

-- This will accurately report the number of other client peers if
-- this is a client thread, or the number of server peers if
-- this is a server thread. It will not count across types.
getSameTypeNumPeers :: MonadIO m => m Int
getSameTypeNumPeers = floor <$> getGauge numPeers
