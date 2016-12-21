module Blockchain.Sequencer.Kafka where

import Control.Lens

import Data.Binary (decode, encode)

import Blockchain.Sequencer.Event
import Blockchain.KafkaTopics (lookupTopic)
import Blockchain.Stream.Raw

import qualified Network.Kafka          as K
import qualified Network.Kafka.Protocol as KP
import qualified Network.Kafka.Producer as KW
import qualified Data.ByteString.Lazy   as BL

assertTopicCreation :: K.Kafka ()
assertTopicCreation = do
    K.updateMetadata $ lookupTopic "unseqevents"
    K.updateMetadata $ lookupTopic "seqevents"

readUnseqEvents :: KP.Offset -> K.Kafka [IngestEvent]
readUnseqEvents offset = do
        K.stateRequiredAcks .= -1
        K.stateWaitSize     .= 1
        K.stateWaitTime     .= 100000
        (map (decode . BL.fromStrict)) <$> fetchBytes (lookupTopic "unseqevents") offset

readSeqEvents :: KP.Offset -> K.Kafka [OutputEvent]
readSeqEvents offset = do
    K.stateRequiredAcks .= -1
    K.stateWaitSize     .= 1
    K.stateWaitTime     .= 100000
    (map (decode . BL.fromStrict)) <$> fetchBytes (lookupTopic "seqevents") offset

writeUnseqEvents :: [IngestEvent] -> K.Kafka [KP.ProduceResponse]
writeUnseqEvents events = KW.produceMessages $
    (K.TopicAndMessage (lookupTopic "unseqevents") . KW.makeMessage . BL.toStrict . encode) <$> events

writeSeqEvents :: [OutputEvent] -> K.Kafka [KP.ProduceResponse]
writeSeqEvents events = KW.produceMessages $
    (K.TopicAndMessage (lookupTopic "seqevents") . KW.makeMessage . BL.toStrict . encode) <$> events
