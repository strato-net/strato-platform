{-# LANGUAGE OverloadedStrings #-}
{-# OPTIONS_GHC -Wall #-}

module Data.Metrics where

import Data.Text (Text)
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

liveBytesMetric :: Vector Text Gauge
liveBytesMetric =
  unsafeRegister
    . vector "process"
    . gauge
    $ Info "strato_rts_live_bytes" "STRATO RTS live bytes"

heapSizeMetric :: Vector Text Gauge
heapSizeMetric =
  unsafeRegister
    . vector "process"
    . gauge
    $ Info "strato_rts_heap_size" "STRATO RTS heap size"