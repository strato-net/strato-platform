{-# LANGUAGE TemplateHaskell #-}
module Blockchain.Sequencer.Metrics where

import           Control.Monad.Stats

defineCounter "ctr.sequencer.blocks.released"         []
defineCounter "ctr.sequencer.blocks.enqueued"         []
defineCounter "ctr.sequencer.blocks.ecrfail"          []
defineCounter "ctr.sequencer.txs.ecrfail"             []
defineCounter "ctr.sequencer.txs.witnessed"           []
defineCounter "ctr.sequencer.txs.unwitnessed"         []
defineCounter "ctr.sequencer.ldb.batch_writes"        []
defineGauge   "ctr.sequencer.ldb.batch_size"          []
defineCounter "ctr.sequencer.kafka.unseq_reads"       []
defineCounter "ctr.sequencer.kafka.seq_writes"        []
defineCounter "ctr.sequencer.kafka.checkpoint_reads"  []
defineCounter "ctr.sequencer.kafka.checkpoint_writes" []

