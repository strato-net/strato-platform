{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE FlexibleInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
module Blockchain.Sequencer.Metrics where

import Control.Monad.IO.Class
import Blockchain.Output
import Control.Monad.Trans.Resource
import Data.Ratio ((%))
import Data.Text
import Prometheus
import System.Clock (Clock(..), diffTimeSpec, getTime, toNanoSecs)

seqLdbBatchWrites :: Counter
seqLdbBatchWrites = unsafeRegister $ counter (Info "seq_ldb_batch_writes" "Sequencer counter for ldb batch writes")

seqLdbBatchSize :: Gauge
seqLdbBatchSize = unsafeRegister $ gauge (Info "seq_ldb_batch_size" "Sequencer gauge for ldb batch size")

seqTxsWitnessed :: Counter
seqTxsWitnessed = unsafeRegister $ counter (Info "seq_txs_witnessed" "Sequencer counter for transactions witnessed")

seqTxsUnwitnessed :: Counter
seqTxsUnwitnessed = unsafeRegister $ counter (Info "seq_txs_unwitnessed" "Sequencer counter for transactions unwitnessed")

seqBlocksEcrfail :: Counter
seqBlocksEcrfail = unsafeRegister $ counter (Info "seq_blocks_ecrfail" "Sequencer counter for blocks ecrfail")

seqBlocksEnqueued :: Counter
seqBlocksEnqueued = unsafeRegister $ counter (Info "seq_blocks_enqueued" "Sequencer counter for blocks enqueued")

seqBlocksReleased :: Counter
seqBlocksReleased = unsafeRegister $ counter (Info "seq_blocks_released" "Sequencer counter for blocks released")

seqLoopTiming :: Summary
seqLoopTiming = unsafeRegister $ summary
              (Info "seq_loop_timing" "Measures iterations of the sequencer loop") defaultQuantiles

seqLoopEvents :: Vector Text Counter
seqLoopEvents = unsafeRegister . vector "type" . counter
              $ Info "seq_loop_events" "Count of event types seen by the sequencer loop"

seqSplitEventsTiming :: Summary
seqSplitEventsTiming = unsafeRegister $ summary
                     (Info "seq_split_events_timing" "Amount of time spent in split events") defaultQuantiles

gregorKafkaCheckpointWrites :: Counter
gregorKafkaCheckpointWrites = unsafeRegister . counter
                            $ Info "gregor_kafka_checkpoint_writes" "Sequencer counter for kafka checkpoint writes"

eventsplitMetrics :: Vector Text Counter
eventsplitMetrics = unsafeRegister
                   . vector "seq_event_type"
                   . counter
                   $ Info "seq_event_splitted" "Counts for splitted events in sequencer"

gregorKafkaCheckpointReads :: Counter
gregorKafkaCheckpointReads = unsafeRegister . counter
                           $ Info "gregor_kafka_checkpoint_reads" "Sequencer counter for kafka checkpoint reads"

gregorLoop :: Vector Text Counter
gregorLoop = unsafeRegister . vector "channel" . counter
           $ Info "gregor_loop_events" "Count of event types seen by gregor"

gregorSeqTiming :: Summary
gregorSeqTiming = unsafeRegister $ summary
                (Info "gregor_seq_timing" "Measures iterations of the gregor loop") defaultQuantiles

gregorUnseqTiming :: Summary
gregorUnseqTiming = unsafeRegister $ summary
                  (Info "gregor_unseq_timing" "Measures iterations of the gregor loop") defaultQuantiles

gregorP2PRead :: Counter
gregorP2PRead = unsafeRegister . counter
              $ Info "gregor_p2p_chan_read" "Gregor counter of events read from the p2p TMChan"

gregorVMRead :: Counter
gregorVMRead = unsafeRegister . counter
             $ Info "gregor_vm_chan_read" "Gregor counter of events read from the vm TMChan"

gregorUnseqRead :: Counter
gregorUnseqRead = unsafeRegister . counter
                $ Info "gregor_unseq_kafka_read" "Gregor counter of events read from the unseq_events kafka channel"

gregorP2PWrite :: Counter
gregorP2PWrite = unsafeRegister . counter
               $ Info "gregor_p2p_kafka_write" "Gregor counter for kafka sequenced_writes"

gregorVMWrite :: Counter
gregorVMWrite = unsafeRegister . counter
              $ Info "gregor_vm_kafka_write" "Gregor counter for kafka unsequenced reads"

gregorUnseqWrite :: Counter
gregorUnseqWrite = unsafeRegister . counter
                 $ Info "gregor_unseq_chan_write" "Gregor counter for TMChan unsequenced writes"

gregorUnseqOffset :: Gauge
gregorUnseqOffset = unsafeRegister . gauge
                  $ Info "gregor_unseq_kafka_offset" "Gauges number of unseq events read"

gregorCheckpointsSent :: Counter
gregorCheckpointsSent = unsafeRegister . counter
                      $ Info "gregor_checkpoints_sent" "Number of checkpoints committed from the reader"

{-# NOINLINE blockHashRegistrySize #-}
blockHashRegistrySize :: Vector Text Gauge
blockHashRegistrySize = unsafeRegister
            . vector "block_hash_registry"
            . gauge
            $ Info "block_hash_registry" "Size count for private chain block hash registry"

{-# NOINLINE txHashRegistrySize #-}
txHashRegistrySize :: Vector Text Gauge
txHashRegistrySize = unsafeRegister
            . vector "tx_hash_registry"
            . gauge
            $ Info "tx_hash_registry" "Size count for private chain tx hash registry"

{-# NOINLINE chainHashRegistrySize #-}
chainHashRegistrySize :: Vector Text Gauge
chainHashRegistrySize = unsafeRegister
            . vector "chain_hash_registry"
            . gauge
            $ Info "chain_hash_registry" "Size count for private chain chain hash registry"

{-# NOINLINE chainIdRegistrySize #-}
chainIdRegistrySize :: Vector Text Gauge
chainIdRegistrySize = unsafeRegister
            . vector "chain_id_registry"
            . gauge
            $ Info "chain_id_registry" "Size count for private chain chain id registry"

{-# NOINLINE getChainsDbSize #-}
getChainsDbSize :: Vector Text Gauge
getChainsDbSize = unsafeRegister
            . vector "get_chains_db"
            . gauge
            $ Info "get_chains_db" "Size count for private chain get chains db"

{-# NOINLINE getTransactionsDbSize #-}
getTransactionsDbSize :: Vector Text Gauge
getTransactionsDbSize = unsafeRegister
            . vector "get_transactions_db"
            . gauge
            $ Info "get_transactions_db" "Size count for private chain get transactions db"

timeAction :: (Observer metric, MonadMonitor m, MonadIO m) => metric -> m a -> m a
timeAction metric act = do
    start <- liftIO $ getTime Monotonic
    res <- act
    end <- liftIO $ getTime Monotonic
    let duration = toNanoSecs (end `diffTimeSpec` start) % 1000000000
    observe metric (fromRational duration)
    return res

instance MonadMonitor (ResourceT (LoggingT IO)) where
    doIO = liftIO
