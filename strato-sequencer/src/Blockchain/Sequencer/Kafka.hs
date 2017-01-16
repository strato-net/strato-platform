module Blockchain.Sequencer.Kafka (
    assertTopicCreation,
    unseqEventsTopicName,
    seqEventsTopicName,
    readUnseqEvents,
    readSeqEvents,
    writeUnseqEvents,
    writeSeqEvents
) where

import Control.Lens

import Data.Binary (decode, encode)

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

assertTopicCreation :: K.Kafka ()
assertTopicCreation = do
    K.updateMetadata unseqEventsTopicName
    K.updateMetadata seqEventsTopicName

readUnseqEvents :: KP.Offset -> K.Kafka [IngestEvent]
readUnseqEvents offset = setDefaultKafkaState >>
    map (decode . BL.fromStrict) <$> fetchBytes unseqEventsTopicName offset

readSeqEvents :: KP.Offset -> K.Kafka [OutputEvent]
readSeqEvents offset = setDefaultKafkaState >>
    map (decode . BL.fromStrict) <$> fetchBytes seqEventsTopicName offset

writeUnseqEvents :: [IngestEvent] -> K.Kafka [KP.ProduceResponse]
writeUnseqEvents events = KW.produceMessages $
    (K.TopicAndMessage unseqEventsTopicName . KW.makeMessage . BL.toStrict . encode) <$> events

writeSeqEvents :: [OutputEvent] -> K.Kafka [KP.ProduceResponse]
writeSeqEvents events = KW.produceMessages $
    (K.TopicAndMessage seqEventsTopicName . KW.makeMessage . BL.toStrict . encode) <$> events
