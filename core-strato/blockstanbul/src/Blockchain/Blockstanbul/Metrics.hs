{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
module Blockchain.Blockstanbul.Metrics where

import Control.Monad.IO.Class
import Data.Text
import Prometheus

import Blockchain.Blockstanbul.Messages

inEventMetric :: Vector Text Counter
inEventMetric = unsafeRegister
              . vector "inevent_type"
              . counter
              $ Info "pbft_inevent" "Count of pbft inEvent"

outEventMetric :: Vector Text Counter
outEventMetric = unsafeRegister
               . vector "outevent_type"
               . counter
               $ Info "pbft_outevent" "Count of pbft outEvent"

currentView :: Vector Text Gauge
currentView = unsafeRegister
            . vector "view_field"
            . gauge
            $ Info "pbft_current_view" "Current (Roundno, Seqno) of PBFT"

replayCounts :: Vector Text Counter
replayCounts = unsafeRegister
             . vector "kind"
             . counter
             $ Info "pbft_replay_counts" "Number of historic blocks that were accepted and rejected"

recordView :: MonadIO m => View -> m ()
recordView View{..} = liftIO $ do
  withLabel currentView "round_number" (flip setGauge . fromIntegral $ _round)
  withLabel currentView "sequence_number" (flip setGauge . fromIntegral $ _sequence)

incHistorySuccess :: MonadIO m => m ()
incHistorySuccess = liftIO $ do
  withLabel replayCounts "total" incCounter
  withLabel replayCounts "success" incCounter

incHistoryFailure :: MonadIO m => m ()
incHistoryFailure = liftIO $ do
  withLabel replayCounts "total" incCounter
  withLabel replayCounts "failure" incCounter
