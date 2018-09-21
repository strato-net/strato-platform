{-# LANGUAGE TemplateHaskell #-}
module Blockchain.Sequencer.Metrics where

import Control.Monad.IO.Class
import Data.Ratio ((%))
import Prometheus
import System.Clock (Clock(..), diffTimeSpec, getTime, toNanoSecs)

seqLdbBatchWrites :: Metric Counter
seqLdbBatchWrites = unsafeRegisterIO $ counter (Info "seq_ldb_batch_writes" "Sequencer counter for ldb batch writes")

seqLdbBatchSize :: Metric Gauge
seqLdbBatchSize = unsafeRegisterIO $ gauge (Info "seq_ldb_batch_size" "Sequencer gauge for ldb batch size")

seqTxsWitnessed :: Metric Counter
seqTxsWitnessed = unsafeRegisterIO $ counter (Info "seq_txs_witnessed" "Sequencer counter for transactions witnessed")

seqTxsUnwitnessed :: Metric Counter
seqTxsUnwitnessed = unsafeRegisterIO $ counter (Info "seq_txs_unwitnessed" "Sequencer counter for transactions unwitnessed")

seqBlocksEcrfail :: Metric Counter
seqBlocksEcrfail = unsafeRegisterIO $ counter (Info "seq_blocks_ecrfail" "Sequencer counter for blocks ecrfail")

seqBlocksEnqueued :: Metric Counter
seqBlocksEnqueued = unsafeRegisterIO $ counter (Info "seq_blocks_enqueued" "Sequencer counter for blocks enqueued")

seqBlocksReleased :: Metric Counter
seqBlocksReleased = unsafeRegisterIO $ counter (Info "seq_blocks_released" "Sequencer counter for blocks released")

seqLoopTiming :: Metric Summary
seqLoopTiming = unsafeRegisterIO $ summary
              (Info "seq_loop_timing" "Measures iterations of the sequencer loop") defaultQuantiles

seqLoopEvents :: Metric (Vector String Counter)
seqLoopEvents = unsafeRegisterIO . vector "type" . counter
              $ Info "seq_loop_events" "Count of event types seen by the sequencer loop"

seqSplitEventsTiming :: Metric Summary
seqSplitEventsTiming = unsafeRegisterIO $ summary
                     (Info "seq_split_events_timing" "Amount of time spent in split events") defaultQuantiles

gregorKafkaCheckpointWrites :: Metric Counter
gregorKafkaCheckpointWrites = unsafeRegisterIO . counter
                            $ Info "gregor_kafka_checkpoint_writes" "Sequencer counter for kafka checkpoint writes"

gregorKafkaCheckpointReads :: Metric Counter
gregorKafkaCheckpointReads = unsafeRegisterIO . counter
                           $ Info "gregor_kafka_checkpoint_reads" "Sequencer counter for kafka checkpoint reads"

gregorLoop :: Metric (Vector String Counter)
gregorLoop = unsafeRegisterIO . vector "channel" . counter
           $ Info "gregor_loop_events" "Count of event types seen by gregor"

gregorSeqTiming :: Metric Summary
gregorSeqTiming = unsafeRegisterIO $ summary
                (Info "gregor_seq_timing" "Measures iterations of the gregor loop") defaultQuantiles

gregorUnseqTiming :: Metric Summary
gregorUnseqTiming = unsafeRegisterIO $ summary
                  (Info "gregor_unseq_timing" "Measures iterations of the gregor loop") defaultQuantiles

gregorP2PRead :: Metric Counter
gregorP2PRead = unsafeRegisterIO . counter
              $ Info "gregor_p2p_chan_read" "Gregor counter of events read from the p2p TMChan"

gregorVMRead :: Metric Counter
gregorVMRead = unsafeRegisterIO . counter
             $ Info "gregor_vm_chan_read" "Gregor counter of events read from the vm TMChan"

gregorUnseqRead :: Metric Counter
gregorUnseqRead = unsafeRegisterIO . counter
                $ Info "gregor_unseq_kafka_read" "Gregor counter of events read from the unseq_events kafka channel"

gregorP2PWrite :: Metric Counter
gregorP2PWrite = unsafeRegisterIO . counter
               $ Info "gregor_p2p_kafka_write" "Gregor counter for kafka sequenced_writes"

gregorVMWrite :: Metric Counter
gregorVMWrite = unsafeRegisterIO . counter
              $ Info "gregor_vm_kafka_write" "Gregor counter for kafka unsequenced reads"

gregorUnseqWrite :: Metric Counter
gregorUnseqWrite = unsafeRegisterIO . counter
                 $ Info "gregor_unseq_chan_write" "Gregor counter for TMChan unsequenced writes"

gregorUnseqOffset :: Metric Gauge
gregorUnseqOffset = unsafeRegisterIO . gauge
                  $ Info "gregor_unseq_kafka_offset" "Gauges number of unseq events read"

timeAction :: (Observer metric, MonadMonitor m, MonadIO m) => Metric metric -> m () -> m ()
timeAction metric act = do
    start <- liftIO $ getTime Monotonic
    act
    end <- liftIO $ getTime Monotonic
    let duration = toNanoSecs (end `diffTimeSpec` start) % 1000000000
    observe (fromRational duration) metric
