{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeOperators #-}

-- {-# OPTIONS -fno-warn-unused-top-binds #-}

module Blockchain.Sequencer.Kafka
  ( assertSequencerTopicsCreation,
    unseqEventsTopicName,
    seqVmEventsTopicName,
    seqP2pEventsTopicName,
    readUnseqEvents,
    writeUnseqEvents,
    writeSeqVmEvents,
    writeSeqP2pEvents,
    writeUnseqEventsWithLimits,
    emitBlockstanbulMsg,
  )
where

import qualified Blockchain.Blockstanbul as PBFT
import Blockchain.KafkaTopics (lookupTopic)
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka.Metrics
import Control.Monad.Change.Modify (Outputs (..))
import Control.Monad.Composable.Kafka
import Data.Binary (Binary, encode)
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import qualified Network.Kafka as K
import qualified Network.Kafka.Producer as KW

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
  execKafka $ KW.produceMessagesAsSingletonSets $
    (K.TopicAndMessage seqVmEventsTopicName . KW.makeMessage . BL.toStrict . encode) <$> events

writeSeqP2pEvents :: HasKafka k => [P2pEvent] -> k [ProduceResponse]
writeSeqP2pEvents events = do
  recordEvents seqP2PWrites events
  execKafka $ KW.produceMessagesAsSingletonSets $
    (K.TopicAndMessage seqP2pEventsTopicName . KW.makeMessage . BL.toStrict . encode) <$> events

writeUnseqEventsWithLimits :: K.Kafka k => [B.ByteString] -> k [ProduceResponse]
writeUnseqEventsWithLimits events = do
  KW.produceMessagesAsSingletonSets $
    (K.TopicAndMessage unseqEventsTopicName . KW.makeMessage) <$> events

readFromTopic' :: (Binary b, HasKafka k) => TopicName -> Offset -> k [b]
readFromTopic' = fetchItems

emitBlockstanbulMsg :: (m `Outputs` [IngestEvent]) => PBFT.WireMessage -> m ()
emitBlockstanbulMsg wm = output [IEBlockstanbul wm]
