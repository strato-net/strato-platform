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

genMetric :: Vector Text Gauge
genMetric =
  unsafeRegister
    . vector "process"
    . gauge
    $ Info "strato_rts_gcdetails_gen" "STRATO RTS GC generation"

threadsMetric :: Vector Text Gauge
threadsMetric =
  unsafeRegister
    . vector "process"
    . gauge
    $ Info "strato_rts_gcdetails_threads" "STRATO RTS GC threads"

allocatedBytesMetric :: Vector Text Gauge
allocatedBytesMetric =
  unsafeRegister
    . vector "process"
    . gauge
    $ Info "strato_rts_gcdetails_allocated_bytes" "STRATO RTS GC allocated bytes"

largeObjectsBytesMetric :: Vector Text Gauge
largeObjectsBytesMetric =
  unsafeRegister
    . vector "process"
    . gauge
    $ Info "strato_rts_gcdetails_large_bjects_bytes" "STRATO RTS GC large objects bytes"

compactBytesMetric :: Vector Text Gauge
compactBytesMetric =
  unsafeRegister
    . vector "process"
    . gauge
    $ Info "strato_rts_gcdetails_compact_bytes" "STRATO RTS GC compact bytes"

slopBytesMetric :: Vector Text Gauge
slopBytesMetric =
  unsafeRegister
    . vector "process"
    . gauge
    $ Info "strato_rts_gcdetails_slop_bytes" "STRATO RTS GC slop bytes"

copiedBytesMetric :: Vector Text Gauge
copiedBytesMetric =
  unsafeRegister
    . vector "process"
    . gauge
    $ Info "strato_rts_gcdetails_copied_bytes" "STRATO RTS GC copied bytes"

blockFragmentationBytesMetric :: Vector Text Gauge
blockFragmentationBytesMetric =
  unsafeRegister
    . vector "process"
    . gauge
    $ Info "strato_rts_gcdetails_block_fragmentation_bytes" "STRATO RTS GC block fragmentation bytes"
