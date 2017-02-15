{-# LANGUAGE FlexibleContexts #-}
module Blockchain.Sequencer.Kafka (
    assertTopicCreation,
    unseqEventsTopicName,
    seqEventsTopicName,
    readUnseqEvents,
    readUnseqEventsFromTopic,
    readSeqEvents,
    readSeqEventsFromTopic,
    writeUnseqEvents,
    writeSeqEvents
) where

import Data.Binary (Binary, decode, encode)

import Blockchain.Sequencer.Event
import Blockchain.KafkaTopics (lookupTopic)
import Blockchain.Stream.Raw

import qualified Network.Kafka          as K
import qualified Network.Kafka.Protocol as KP
import qualified Network.Kafka.Producer as KW
import qualified Data.ByteString.Lazy   as BL

unseqEventsTopicName :: KP.TopicName
unseqEventsTopicName = lookupTopic "unseqevents"

seqEventsTopicName :: KP.TopicName
seqEventsTopicName = lookupTopic "seqevents"

assertTopicCreation :: K.Kafka k => k ()
assertTopicCreation = do
    K.updateMetadata unseqEventsTopicName
    K.updateMetadata seqEventsTopicName

readUnseqEvents :: K.Kafka k => KP.Offset -> k [IngestEvent]
readUnseqEvents offset = setDefaultKafkaState >>
    map (decode . BL.fromStrict) <$> fetchBytes unseqEventsTopicName offset

readUnseqEventsFromTopic :: K.Kafka k => KP.TopicName -> KP.Offset -> k [IngestEvent]
readUnseqEventsFromTopic = readFromTopic'
{-# INLINE readUnseqEventsFromTopic #-}

readSeqEvents :: K.Kafka k => KP.Offset -> k [OutputEvent]
readSeqEvents = readSeqEventsFromTopic seqEventsTopicName

readSeqEventsFromTopic :: K.Kafka k => KP.TopicName -> KP.Offset -> k [OutputEvent]
readSeqEventsFromTopic = readFromTopic'
{-# INLINE readSeqEventsFromTopic #-}

writeUnseqEvents :: K.Kafka k => [IngestEvent] -> k [KP.ProduceResponse]
writeUnseqEvents events = KW.produceMessages $
    (K.TopicAndMessage unseqEventsTopicName . KW.makeMessage . BL.toStrict . encode) <$> events

writeSeqEvents :: K.Kafka k => [OutputEvent] -> k [KP.ProduceResponse]
writeSeqEvents events = KW.produceMessages $
    (K.TopicAndMessage seqEventsTopicName . KW.makeMessage . BL.toStrict . encode) <$> events

readFromTopic' :: (Binary b, K.Kafka k) => KP.TopicName -> KP.Offset -> k [b]
readFromTopic' topic offset = setDefaultKafkaState >>
    map (decode . BL.fromStrict) <$> fetchBytes topic offset
{-# INLINE readFromTopic' #-}