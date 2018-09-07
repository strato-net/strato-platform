{-# LANGUAGE TemplateHaskell #-}
module Blockchain.Sequencer.Metrics where

import           Prometheus                                as P

sqcLdbBatchWrites:: P.Metric P.Counter
sqcLdbBatchWrites = P.unsafeRegisterIO $ counter (P.Info "Ctr_sequencer_ldb_batch_writes" "Sequencer counter for ldb batch writes")

sqcLdbBatchSize :: P.Metric P.Gauge
sqcLdbBatchSize = P.unsafeRegisterIO $ gauge (P.Info "ctr_sequencer_ldb_batch_size" "Sequencer gauge for ldb batch size")


sqcTxsWitnessed :: P.Metric P.Counter
sqcTxsWitnessed = P.unsafeRegisterIO $ counter (P.Info "ctr_sequencer_txs_witnessed" "Sequencer counter for transactions witnessed")

sqcTxsUnwitnessed :: P.Metric P.Counter
sqcTxsUnwitnessed = P.unsafeRegisterIO $ counter (P.Info "ctr_sequencer_txs_unwitnessed" "Sequencer counter for transactions unwitnessed")

sqcBlocksEcrfail :: P.Metric P.Counter
sqcBlocksEcrfail = P.unsafeRegisterIO $ counter (P.Info "ctr_sequencer_blocks_ecrfail" "Sequencer counter for blocks ecrfail")

sqcBlocksEnqueued :: P.Metric P.Counter
sqcBlocksEnqueued = P.unsafeRegisterIO $ counter (P.Info "ctr_sequencer_blocks_enqueued" "Sequencer counter for blocks enqueued")

sqcKafkaCheckpointWrites :: P.Metric P.Counter
sqcKafkaCheckpointWrites = P.unsafeRegisterIO $ counter (P.Info "ctr_sequencer_kafka_checkpoint_writes" "Sequencer counter for kafka checkpoint writes")

sqcKafkaCheckpointReads :: P.Metric P.Counter
sqcKafkaCheckpointReads = P.unsafeRegisterIO $ counter (P.Info "ctr_sequencer_kafka_checkpoint_reads" "Sequencer counter for kafka checkpoint reads")

sqcKafkaSeqWrites :: P.Metric P.Counter
sqcKafkaSeqWrites = P.unsafeRegisterIO $ counter (P.Info "ctr_sequencer_kafka_sequenced_writes" "Sequencer counter for kafka sequenced_writes")

sqcKafkaUnseqRead :: P.Metric P.Counter
sqcKafkaUnseqRead = P.unsafeRegisterIO $ counter (P.Info "ctr_sequencer_kafka_unsequenced_reads" "Sequencer counter for kafka unsequenced reads")

sqcBlocksReleased :: P.Metric P.Counter
sqcBlocksReleased = P.unsafeRegisterIO $ counter (P.Info "ctr_sequencer_blocks_released" "Sequencer counter for blocks released")


