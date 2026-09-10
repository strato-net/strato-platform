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

-- Cumulative RTS totals (monotonic counters, exported as gauges holding the
-- running total). Unlike the per-GC gcdetails above, these make productivity
-- (mutator time / total time) observable: rate(strato_rts_gc_cpu_ns) /
-- rate(strato_rts_cpu_ns) is the GC fraction.

gcCpuNsMetric :: Vector Text Gauge
gcCpuNsMetric =
  unsafeRegister
    . vector "process"
    . gauge
    $ Info "strato_rts_gc_cpu_ns" "STRATO RTS cumulative CPU time spent in GC (ns)"

gcElapsedNsMetric :: Vector Text Gauge
gcElapsedNsMetric =
  unsafeRegister
    . vector "process"
    . gauge
    $ Info "strato_rts_gc_elapsed_ns" "STRATO RTS cumulative wall-clock time spent in GC (ns)"

cpuNsMetric :: Vector Text Gauge
cpuNsMetric =
  unsafeRegister
    . vector "process"
    . gauge
    $ Info "strato_rts_cpu_ns" "STRATO RTS cumulative process CPU time (ns)"

elapsedNsMetric :: Vector Text Gauge
elapsedNsMetric =
  unsafeRegister
    . vector "process"
    . gauge
    $ Info "strato_rts_elapsed_ns" "STRATO RTS cumulative process wall-clock time (ns)"

gcsMetric :: Vector Text Gauge
gcsMetric =
  unsafeRegister
    . vector "process"
    . gauge
    $ Info "strato_rts_gcs" "STRATO RTS cumulative number of GCs"

majorGcsMetric :: Vector Text Gauge
majorGcsMetric =
  unsafeRegister
    . vector "process"
    . gauge
    $ Info "strato_rts_major_gcs" "STRATO RTS cumulative number of major GCs"
