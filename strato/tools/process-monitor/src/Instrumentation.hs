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
import Data.Text (Text, unpack)
import GHC.Stats
import Prometheus

takeRtsSample :: Text -> IO ()
takeRtsSample name = do
  rts <- getRTSStats
  withLabel heapSizeMetric  name (flip setGauge . fromIntegral . gcdetails_mem_in_use_bytes $ gc rts)
  withLabel liveBytesMetric name (flip setGauge . fromIntegral . gcdetails_live_bytes       $ gc rts)

runInstrumentation :: Text -> IO ()
runInstrumentation name = do
  enabled <- getRTSStatsEnabled
  when enabled $ do
    putStrLn . unpack $ "Instrumentation for " <> name <> " is enabled"
    void . forkIO . forever $ do
      threadDelay 1000000
      takeRtsSample name