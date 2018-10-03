{-# LANGUAGE TemplateHaskell #-}
module Blockchain.Sequencer.Metrics where

import           Prometheus                                as P

seqLdbBatchWrites:: P.Metric P.Counter
seqLdbBatchWrites = P.unsafeRegisterIO $ counter (P.Info "seq_ldb_batch_writes" "Sequencer counter for ldb batch writes")

seqLdbBatchSize :: P.Metric P.Gauge
seqLdbBatchSize = P.unsafeRegisterIO $ gauge (P.Info "seq_ldb_batch_size" "Sequencer gauge for ldb batch size")

seqTxsWitnessed :: P.Metric P.Counter
seqTxsWitnessed = P.unsafeRegisterIO $ counter (P.Info "seq_txs_witnessed" "Sequencer counter for transactions witnessed")

seqTxsUnwitnessed :: P.Metric P.Counter
seqTxsUnwitnessed = P.unsafeRegisterIO $ counter (P.Info "seq_txs_unwitnessed" "Sequencer counter for transactions unwitnessed")

seqBlocksEcrfail :: P.Metric P.Counter
seqBlocksEcrfail = P.unsafeRegisterIO $ counter (P.Info "seq_blocks_ecrfail" "Sequencer counter for blocks ecrfail")

seqBlocksEnqueued :: P.Metric P.Counter
seqBlocksEnqueued = P.unsafeRegisterIO $ counter (P.Info "seq_blocks_enqueued" "Sequencer counter for blocks enqueued")

seqKafkaCheckpointWrites :: P.Metric P.Counter
seqKafkaCheckpointWrites = P.unsafeRegisterIO $ counter (P.Info "seq_kafka_checkpoint_writes" "Sequencer counter for kafka checkpoint writes")

seqKafkaCheckpointReads :: P.Metric P.Counter
seqKafkaCheckpointReads = P.unsafeRegisterIO $ counter (P.Info "seq_kafka_checkpoint_reads" "Sequencer counter for kafka checkpoint reads")

seqKafkaSeqWrites :: P.Metric P.Counter
seqKafkaSeqWrites = P.unsafeRegisterIO $ counter (P.Info "seq_kafka_sequenced_writes" "Sequencer counter for kafka sequenced_writes")

seqKafkaUnseqRead :: P.Metric P.Counter
seqKafkaUnseqRead = P.unsafeRegisterIO $ counter (P.Info "seq_kafka_unsequenced_reads" "Sequencer counter for kafka unsequenced reads")

seqBlocksReleased :: P.Metric P.Counter
seqBlocksReleased = P.unsafeRegisterIO $ counter (P.Info "seq_blocks_released" "Sequencer counter for blocks released")

eventsplitMetrics :: Metric (Vector String Counter)
eventsplitMetrics = unsafeRegisterIO
                   . vector "seq_event_type"
                   . counter
                   $ Info "seq_event_type" "Counts for splitted events in sequencer"
