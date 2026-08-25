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
    writeSeqEvents,
    emitBlockstanbulMsg,
  )
where

import qualified Blockchain.Blockstanbul as PBFT
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka.Metrics
import Control.Monad.Change.Modify (Outputs (..))
import Control.Monad.Composable.Streaming
import Data.Binary (encode)


unseqEventsTopicName :: TopicName
unseqEventsTopicName = "unseqevents"

seqVmTasksTopicName :: TopicName
seqVmTasksTopicName = "vm_tasks"

seqP2pEventsTopicName :: TopicName
seqP2pEventsTopicName = "seq_p2p_events"

assertSequencerTopicsCreation :: HasStreaming m => m ()
assertSequencerTopicsCreation = do
  createTopicAndWait unseqEventsTopicName
  createTopicAndWait seqVmTasksTopicName
  createTopicAndWait seqP2pEventsTopicName

writeUnseqEvents :: HasStreaming k => [IngestEvent] -> k [ProduceResponse]
writeUnseqEvents events = do
  produceItems unseqEventsTopicName events

writeSeqVmTasks :: HasStreaming k => [VmTask] -> k [ProduceResponse]
writeSeqVmTasks events = do
  recordEvents seqVMWrites events
  produceItems seqVmTasksTopicName events

writeSeqP2pEvents :: HasStreaming k => [P2pEvent] -> k [ProduceResponse]
writeSeqP2pEvents events = do
  recordEvents seqP2PWrites events
  produceItems seqP2pEventsTopicName events

-- | Write both sequencer output topics in ONE Kafka request.
--
-- Committing a block emits a P2pBlock and a VmBlock, and writing them with two
-- 'produceItems' calls costs two synchronous acks=all round trips per block —
-- measured at ~90% of the sequencer's wall clock during historic replay.
-- They are independent topics, so there is no ordering reason to send them
-- separately.
writeSeqEvents :: HasStreaming k => [P2pEvent] -> [VmTask] -> k [ProduceResponse]
writeSeqEvents p2pEvents vmTasks = do
  recordEvents seqP2PWrites p2pEvents
  recordEvents seqVMWrites vmTasks
  produceToTopics
    [ (seqP2pEventsTopicName, encode <$> p2pEvents),
      (seqVmTasksTopicName, encode <$> vmTasks)
    ]

emitBlockstanbulMsg :: (m `Outputs` [IngestEvent]) => PBFT.WireMessage -> m ()
emitBlockstanbulMsg wm = output [IEBlockstanbul wm]
