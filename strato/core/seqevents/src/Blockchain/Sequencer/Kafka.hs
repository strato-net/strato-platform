{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Sequencer.Kafka
  ( assertSequencerTopicsCreation,
    unseqEventsTopicName,
    seqVmEventsTopicName,
    seqP2pEventsTopicName,
    readUnseqEvents,
    writeUnseqEvents,
    writeSeqVmEvents,
    writeSeqP2pEvents,
    emitBlockstanbulMsg,
  )
where

import qualified Blockchain.Blockstanbul as PBFT
import Blockchain.KafkaTopics (lookupTopic)
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka.Metrics
import Control.Monad.Change.Modify (Outputs (..))
import Control.Monad.Composable.Kafka
import Data.Binary (Binary)

unseqEventsTopicName :: TopicName
unseqEventsTopicName = lookupTopic "unseqevents"

seqVmEventsTopicName :: TopicName
seqVmEventsTopicName = lookupTopic "seq_vm_events"

seqP2pEventsTopicName :: TopicName
seqP2pEventsTopicName = lookupTopic "seq_p2p_events"

assertSequencerTopicsCreation :: HasKafka m => m ()
assertSequencerTopicsCreation = do
  createTopic unseqEventsTopicName
  createTopic seqVmEventsTopicName
  createTopic seqP2pEventsTopicName

readUnseqEvents :: HasKafka k => Offset -> k [IngestEvent]
readUnseqEvents off = do
  events <- readUnseqEventsFromTopic unseqEventsTopicName off
  return events

readUnseqEventsFromTopic :: HasKafka k => TopicName -> Offset -> k [IngestEvent]
readUnseqEventsFromTopic = readFromTopic'
{-# INLINE readUnseqEventsFromTopic #-}

writeUnseqEvents :: HasKafka k => [IngestEvent] -> k [ProduceResponse]
writeUnseqEvents events = do
  produceItems unseqEventsTopicName events

writeSeqVmEvents :: HasKafka k => [VmEvent] -> k [ProduceResponse]
writeSeqVmEvents events = do
  recordEvents seqVMWrites events
  produceItems seqVmEventsTopicName events

writeSeqP2pEvents :: HasKafka k => [P2pEvent] -> k [ProduceResponse]
writeSeqP2pEvents events = do
  recordEvents seqP2PWrites events
  produceItems seqP2pEventsTopicName events

readFromTopic' :: (Binary b, HasKafka k) => TopicName -> Offset -> k [b]
readFromTopic' = fetchItems

emitBlockstanbulMsg :: (m `Outputs` [IngestEvent]) => PBFT.WireMessage -> m ()
emitBlockstanbulMsg wm = output [IEBlockstanbul wm]
