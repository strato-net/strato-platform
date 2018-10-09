{-# LANGUAGE RecordWildCards #-}
module Blockchain.Blockstanbul.Metrics where

import Prometheus
import Blockchain.Blockstanbul.Messages

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

currentView :: Metric (Vector String Gauge)
currentView = unsafeRegisterIO
            . vector "view_field"
            . gauge
            $ Info "pbft_current_view" "Current (Roundno, Seqno) of PBFT"

recordView :: (MonadMonitor m) => View -> m ()
recordView View{..} = do
  withLabel "round_number" (setGauge _round) currentView
  withLabel "sequence_number" (setGauge _sequence) currentView
