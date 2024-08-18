{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE Strict #-}
{-# LANGUAGE TupleSections #-}
{-# OPTIONS_GHC -Wall #-}

module Instrumentation where

import Control.Concurrent (forkIO, threadDelay)
import Control.Monad (forever, void, when)
import Data.Metrics
import Data.Text (Text)
import GHC.Stats
import Prometheus

takeRtsSample :: Gauge -> Gauge -> IO ()
takeRtsSample heapSize liveBytes = do
  rts <- getRTSStats
  setGauge heapSize  . fromIntegral . gcdetails_live_bytes       $ gc rts
  setGauge liveBytes . fromIntegral . gcdetails_mem_in_use_bytes $ gc rts

runInstrumentation :: Text -> IO ()
runInstrumentation name = do
  enabled <- getRTSStatsEnabled
  when enabled $ do
    heapSize <- createRtsHeapSizeGauge name
    liveBytes <- createRtsLiveBytesGauge name
    void . forkIO . forever $ do
      threadDelay 1000000
      takeRtsSample heapSize liveBytes