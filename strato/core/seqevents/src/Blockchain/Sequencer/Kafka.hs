{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Sequencer.Kafka
  ( assertTopicCreation,
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
import Blockchain.Stream.Raw
import Control.Monad.Change.Modify (Outputs (..))
import Control.Monad.Composable.Kafka
import Data.Binary (Binary, decode, encode)
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import qualified Network.Kafka as K
import qualified Network.Kafka.Producer as KW
import qualified Network.Kafka.Protocol as KP

unseqEventsTopicName :: KP.TopicName
unseqEventsTopicName = lookupTopic "unseqevents"

seqVmEventsTopicName :: KP.TopicName
seqVmEventsTopicName = lookupTopic "seq_vm_events"

seqP2pEventsTopicName :: KP.TopicName
seqP2pEventsTopicName = lookupTopic "seq_p2p_events"

assertTopicCreation :: K.Kafka k => k ()
assertTopicCreation = do
  K.updateMetadata unseqEventsTopicName
  K.updateMetadata seqVmEventsTopicName
  K.updateMetadata seqP2pEventsTopicName

readUnseqEvents :: HasKafka k => KP.Offset -> k [IngestEvent]
readUnseqEvents off = do
  events <- readUnseqEventsFromTopic unseqEventsTopicName off
  return events

readUnseqEventsFromTopic :: HasKafka k => KP.TopicName -> KP.Offset -> k [IngestEvent]
readUnseqEventsFromTopic = readFromTopic'
{-# INLINE readUnseqEventsFromTopic #-}

readSeqVmEvents :: HasKafka k => KP.Offset -> k [VmEvent]
readSeqVmEvents off = do
  events <- readSeqVmEventsFromTopic seqVmEventsTopicName off
  recordEvents seqVMReads events
  return events

readSeqVmEventsFromTopic :: HasKafka k => KP.TopicName -> KP.Offset -> k [VmEvent]
readSeqVmEventsFromTopic = readFromTopic'
{-# INLINE readSeqVmEventsFromTopic #-}

readSeqP2pEvents :: K.Kafka k => KP.Offset -> k [P2pEvent]
readSeqP2pEvents off = do
  events <- readSeqP2pEventsFromTopic seqP2pEventsTopicName off
  recordEvents seqP2PReads events
  return events

readSeqP2pEventsFromTopic :: K.Kafka k => KP.TopicName -> KP.Offset -> k [P2pEvent]
readSeqP2pEventsFromTopic = readFromTopicOld'
{-# INLINE readSeqP2pEventsFromTopic #-}

writeUnseqEvents :: K.Kafka k => [IngestEvent] -> k [KP.ProduceResponse]
writeUnseqEvents events = do
  KW.produceMessagesAsSingletonSets $
    (K.TopicAndMessage unseqEventsTopicName . KW.makeMessage . BL.toStrict . encode) <$> events

writeSeqVmEvents :: K.Kafka k => [VmEvent] -> k [KP.ProduceResponse]
writeSeqVmEvents events = do
  recordEvents seqVMWrites events
  KW.produceMessagesAsSingletonSets $
    (K.TopicAndMessage seqVmEventsTopicName . KW.makeMessage . BL.toStrict . encode) <$> events

writeSeqP2pEvents :: K.Kafka k => [P2pEvent] -> k [KP.ProduceResponse]
writeSeqP2pEvents events = do
  recordEvents seqP2PWrites events
  KW.produceMessagesAsSingletonSets $
    (K.TopicAndMessage seqP2pEventsTopicName . KW.makeMessage . BL.toStrict . encode) <$> events

writeUnseqEventsWithLimits :: K.Kafka k => [B.ByteString] -> k [KP.ProduceResponse]
writeUnseqEventsWithLimits events = do
  KW.produceMessagesAsSingletonSets $
    (K.TopicAndMessage unseqEventsTopicName . KW.makeMessage) <$> events

readFromTopic' :: (Binary b, HasKafka k) => KP.TopicName -> KP.Offset -> k [b]
readFromTopic' = fetchItems

readFromTopicOld' :: (Binary b, K.Kafka k) => KP.TopicName -> KP.Offset -> k [b]
readFromTopicOld' topic offset = do 
  _ <- setDefaultKafkaState
  bytes <- fetchBytes topic offset
  return $ map (decode . BL.fromStrict) bytes
--  map (decode . BL.fromStrict) <$> fetchBytes topic offset
{-# INLINE readFromTopic' #-}

emitBlockstanbulMsg :: (m `Outputs` [IngestEvent]) => PBFT.WireMessage -> m ()
emitBlockstanbulMsg wm = output [IEBlockstanbul wm]
