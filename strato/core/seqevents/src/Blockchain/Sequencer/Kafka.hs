{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeOperators #-}

{-# OPTIONS -fno-warn-unused-top-binds #-}

module Blockchain.Sequencer.Kafka
  ( assertSequencerTopicsCreation,
    unseqEventsTopicName,
    seqVmEventsTopicName,
    seqP2pEventsTopicName,
    readUnseqEvents,
    readSeqVmEvents,
    readSeqP2pEvents,
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
import qualified Network.Kafka.Protocol as KP

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

readUnseqEvents :: HasKafka k => KP.Offset -> k [IngestEvent]
readUnseqEvents off = do
  events <- readUnseqEventsFromTopic unseqEventsTopicName off
  return events

readUnseqEventsFromTopic :: HasKafka k => TopicName -> KP.Offset -> k [IngestEvent]
readUnseqEventsFromTopic = readFromTopic'
{-# INLINE readUnseqEventsFromTopic #-}

readSeqVmEvents :: HasKafka k => KP.Offset -> k [VmEvent]
readSeqVmEvents off = do
  events <- readSeqVmEventsFromTopic seqVmEventsTopicName off
  recordEvents seqVMReads events
  return events

readSeqVmEventsFromTopic :: HasKafka k => TopicName -> KP.Offset -> k [VmEvent]
readSeqVmEventsFromTopic = readFromTopic'
{-# INLINE readSeqVmEventsFromTopic #-}

readSeqP2pEvents :: HasKafka m => KP.Offset -> m [P2pEvent]
readSeqP2pEvents off = do
  events <- readSeqP2pEventsFromTopic seqP2pEventsTopicName off
  recordEvents seqP2PReads events
  return events

readSeqP2pEventsFromTopic :: HasKafka m => TopicName -> KP.Offset -> m [P2pEvent]
readSeqP2pEventsFromTopic = readFromTopic'
{-# INLINE readSeqP2pEventsFromTopic #-}

writeUnseqEvents :: HasKafka k => [IngestEvent] -> k [KP.ProduceResponse]
writeUnseqEvents events = do
  produceItems unseqEventsTopicName events


writeSeqVmEvents :: HasKafka k => [VmEvent] -> k [KP.ProduceResponse]
writeSeqVmEvents events = do
  recordEvents seqVMWrites events
  execKafka $ KW.produceMessagesAsSingletonSets $
    (K.TopicAndMessage seqVmEventsTopicName . KW.makeMessage . BL.toStrict . encode) <$> events

writeSeqP2pEvents :: HasKafka k => [P2pEvent] -> k [KP.ProduceResponse]
writeSeqP2pEvents events = do
  recordEvents seqP2PWrites events
  execKafka $ KW.produceMessagesAsSingletonSets $
    (K.TopicAndMessage seqP2pEventsTopicName . KW.makeMessage . BL.toStrict . encode) <$> events

writeUnseqEventsWithLimits :: K.Kafka k => [B.ByteString] -> k [KP.ProduceResponse]
writeUnseqEventsWithLimits events = do
  KW.produceMessagesAsSingletonSets $
    (K.TopicAndMessage unseqEventsTopicName . KW.makeMessage) <$> events

readFromTopic' :: (Binary b, HasKafka k) => TopicName -> KP.Offset -> k [b]
readFromTopic' = fetchItems

emitBlockstanbulMsg :: (m `Outputs` [IngestEvent]) => PBFT.WireMessage -> m ()
emitBlockstanbulMsg wm = output [IEBlockstanbul wm]
