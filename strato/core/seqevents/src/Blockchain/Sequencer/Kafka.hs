{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Sequencer.Kafka
  ( assertSequencerTopicsCreation,
    unseqEventsTopicName,
    seqVmTasksTopicName,
    seqP2pEventsTopicName,
    writeUnseqEvents,
    writeSeqVmTasks,
    writeSeqP2pEvents,
    emitBlockstanbulMsg,
  )
where

import qualified Blockchain.Blockstanbul as PBFT
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka.Metrics
import Control.Monad.Change.Modify (Outputs (..))
import Control.Monad.Composable.Kafka


unseqEventsTopicName :: TopicName
unseqEventsTopicName = "unseqevents"

seqVmTasksTopicName :: TopicName
seqVmTasksTopicName = "vm_tasks"

seqP2pEventsTopicName :: TopicName
seqP2pEventsTopicName = "seq_p2p_events"

assertSequencerTopicsCreation :: HasKafka m => m ()
assertSequencerTopicsCreation = do
  createTopicAndWait unseqEventsTopicName
  createTopicAndWait seqVmTasksTopicName
  createTopicAndWait seqP2pEventsTopicName

writeUnseqEvents :: HasKafka k => [IngestEvent] -> k [ProduceResponse]
writeUnseqEvents events = do
  produceItems unseqEventsTopicName events

writeSeqVmTasks :: HasKafka k => [VmTask] -> k [ProduceResponse]
writeSeqVmTasks events = do
  recordEvents seqVMWrites events
  produceItems seqVmTasksTopicName events

writeSeqP2pEvents :: HasKafka k => [P2pEvent] -> k [ProduceResponse]
writeSeqP2pEvents events = do
  recordEvents seqP2PWrites events
  produceItems seqP2pEventsTopicName events

emitBlockstanbulMsg :: (m `Outputs` [IngestEvent]) => PBFT.WireMessage -> m ()
emitBlockstanbulMsg wm = output [IEBlockstanbul wm]
