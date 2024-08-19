{-# LANGUAGE OverloadedStrings #-}
{-# OPTIONS_GHC -Wall #-}

module Data.Metrics where

import Data.Text (Text)
import qualified Data.Text as T
import Prometheus

{-# NOINLINE cpuMetric #-}
cpuMetric :: Vector Text Gauge
cpuMetric =
  unsafeRegister
    . vector "process"
    . gauge
    $ Info "strato_cpu_usage" "Process CPU usage"

{-# NOINLINE memMetric #-}
memMetric :: Vector Text Gauge
memMetric =
  unsafeRegister
    . vector "process"
    . gauge
    $ Info "strato_memory_usage" "Process memory usage"

createRtsLiveBytesGauge :: Text -> IO Gauge
createRtsLiveBytesGauge name =
  register
    . gauge
    $ Info (name <> "_rts_live_bytes") (name <> " RTS live bytes")

createRtsHeapSizeGauge :: Text -> IO Gauge
createRtsHeapSizeGauge name =
  register
    . gauge
    $ Info (T.replace "-" "_" name <> "_rts_heap_size") (name <> "RTS heap size")