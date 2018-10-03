{-# LANGUAGE LambdaCase #-}
module Blockchain.Blockstanbul.Metrics where

import           Prometheus

inEventMetric :: Metric (Vector String Counter)
inEventMetric = unsafeRegisterIO
               . vector "inevent_type"
               . counter
               $ Info "pbft_inevent" "Count of pbft inEvent"

outEventMetric :: Metric (Vector String Counter)
outEventMetric = unsafeRegisterIO
               . vector "outevent_type"
               . counter
               $ Info "pbft_outevent" "Count of pbft outEvent"

