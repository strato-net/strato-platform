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
  withLabel heapSizeMetric                name (flip setGauge . fromIntegral . gcdetails_mem_in_use_bytes          $ gc rts)
  withLabel liveBytesMetric               name (flip setGauge . fromIntegral . gcdetails_live_bytes                $ gc rts)
  withLabel genMetric                     name (flip setGauge . fromIntegral . gcdetails_gen                       $ gc rts)
  withLabel threadsMetric                 name (flip setGauge . fromIntegral . gcdetails_threads                   $ gc rts)
  withLabel allocatedBytesMetric          name (flip setGauge . fromIntegral . gcdetails_allocated_bytes           $ gc rts)
  withLabel largeObjectsBytesMetric       name (flip setGauge . fromIntegral . gcdetails_large_objects_bytes       $ gc rts)
  withLabel compactBytesMetric            name (flip setGauge . fromIntegral . gcdetails_compact_bytes             $ gc rts)
  withLabel slopBytesMetric               name (flip setGauge . fromIntegral . gcdetails_slop_bytes                $ gc rts)
  withLabel copiedBytesMetric             name (flip setGauge . fromIntegral . gcdetails_copied_bytes              $ gc rts)
  withLabel blockFragmentationBytesMetric name (flip setGauge . fromIntegral . gcdetails_block_fragmentation_bytes $ gc rts)
  withLabel gcCpuNsMetric                 name (flip setGauge . fromIntegral $ gc_cpu_ns     rts)
  withLabel gcElapsedNsMetric             name (flip setGauge . fromIntegral $ gc_elapsed_ns rts)
  withLabel cpuNsMetric                   name (flip setGauge . fromIntegral $ cpu_ns        rts)
  withLabel elapsedNsMetric               name (flip setGauge . fromIntegral $ elapsed_ns    rts)
  withLabel gcsMetric                     name (flip setGauge . fromIntegral $ gcs           rts)
  withLabel majorGcsMetric                name (flip setGauge . fromIntegral $ major_gcs     rts)

runInstrumentation :: Text -> IO ()
runInstrumentation name = do
  enabled <- getRTSStatsEnabled
  when enabled $ do
    putStrLn . unpack $ "Instrumentation for " <> name <> " is enabled"
    void . forkIO . forever $ do
      threadDelay 1000000
      takeRtsSample name
