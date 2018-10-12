{-# LANGUAGE FlexibleContexts #-}
module Blockchain.Sequencer.Kafka (
    assertTopicCreation,
    unseqEventsTopicName,
    seqVmEventsTopicName,
    seqP2pEventsTopicName,
    readUnseqEvents,
    readUnseqEventsFromTopic,
    readSeqVmEvents,
    readSeqP2pEvents,
    readSeqVmEventsFromTopic,
    readSeqP2pEventsFromTopic,
    writeUnseqEvents,
    writeSeqVmEvents,
    writeSeqP2pEvents,
    HasUnseqSink(..),
    emitKafkaTransactions,
    emitKafkaBlock,
    emitKafkaChainDetails,
    emitBlockstanbulMsg
) where

import           Conduit
import           Data.Binary                (Binary, decode, encode)

import qualified Blockchain.Blockstanbul as PBFT
import           Blockchain.Data.BlockDB
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.Transaction
import qualified Blockchain.Data.TXOrigin              as Origin
import           Blockchain.KafkaTopics     (lookupTopic)
import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Model.ExtendedWord  (Word256)
import           Blockchain.Stream.Raw
import           Blockchain.Util

import qualified Data.ByteString.Lazy       as BL
import qualified Network.Kafka              as K
import qualified Network.Kafka.Producer     as KW
import qualified Network.Kafka.Protocol     as KP

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

readUnseqEvents :: K.Kafka k => KP.Offset -> k [IngestEvent]
readUnseqEvents = readUnseqEventsFromTopic unseqEventsTopicName

readUnseqEventsFromTopic :: K.Kafka k => KP.TopicName -> KP.Offset -> k [IngestEvent]
readUnseqEventsFromTopic = readFromTopic'
{-# INLINE readUnseqEventsFromTopic #-}

readSeqVmEvents :: K.Kafka k => KP.Offset -> k [OutputEvent]
readSeqVmEvents = readSeqVmEventsFromTopic seqVmEventsTopicName

readSeqVmEventsFromTopic :: K.Kafka k => KP.TopicName -> KP.Offset -> k [OutputEvent]
readSeqVmEventsFromTopic = readFromTopic'
{-# INLINE readSeqVmEventsFromTopic #-}

readSeqP2pEvents :: K.Kafka k => KP.Offset -> k [OutputEvent]
readSeqP2pEvents = readSeqP2pEventsFromTopic seqP2pEventsTopicName

readSeqP2pEventsFromTopic :: K.Kafka k => KP.TopicName -> KP.Offset -> k [OutputEvent]
readSeqP2pEventsFromTopic = readFromTopic'
{-# INLINE readSeqP2pEventsFromTopic #-}

writeUnseqEvents :: K.Kafka k => [IngestEvent] -> k [KP.ProduceResponse]
writeUnseqEvents events = KW.produceMessages $
    (K.TopicAndMessage unseqEventsTopicName . KW.makeMessage . BL.toStrict . encode) <$> events

writeSeqVmEvents :: K.Kafka k => [OutputEvent] -> k [KP.ProduceResponse]
writeSeqVmEvents events = KW.produceMessages $
    (K.TopicAndMessage seqVmEventsTopicName . KW.makeMessage . BL.toStrict . encode) <$> events

writeSeqP2pEvents :: K.Kafka k => [OutputEvent] -> k [KP.ProduceResponse]
writeSeqP2pEvents events = KW.produceMessages $
    (K.TopicAndMessage seqP2pEventsTopicName . KW.makeMessage . BL.toStrict . encode) <$> events

readFromTopic' :: (Binary b, K.Kafka k) => KP.TopicName -> KP.Offset -> k [b]
readFromTopic' topic offset = do
  _ <- setDefaultKafkaState
  bytes <- fetchBytes topic offset
  return $ map (decode . BL.fromStrict) bytes
  --  map (decode . BL.fromStrict) <$> fetchBytes topic offset
{-# INLINE readFromTopic' #-}

class HasUnseqSink k where
  getUnseqSink :: k ([IngestEvent] -> k ())


emitKafkaTransactions :: (MonadIO m, HasUnseqSink m) => Origin.TXOrigin -> [Transaction] -> m ()
emitKafkaTransactions origin txs = do
    ts <- liftIO getCurrentMicrotime
    let ingestTxs = IETx ts . IngestTx origin <$> txs
    sink <- getUnseqSink
    sink ingestTxs

emitKafkaBlock :: (Monad m, HasUnseqSink m) => Origin.TXOrigin -> Block -> m ()
emitKafkaBlock origin baseBlock = do
    let ingestBlock = IEBlock $ blockToIngestBlock origin baseBlock
    sink <- getUnseqSink
    sink [ingestBlock]

emitKafkaChainDetails :: (MonadIO m, HasUnseqSink m) => Origin.TXOrigin -> Word256 -> ChainInfo -> m ()
emitKafkaChainDetails origin chainId details = do
    let ingestGenesis = IEGenesis (IngestGenesis origin (chainId, details))
    sink <- getUnseqSink
    sink [ingestGenesis]

emitBlockstanbulMsg :: (MonadIO m, HasUnseqSink m) => PBFT.WireMessage -> m ()
emitBlockstanbulMsg wm = do
  let iem = IEBlockstanbul wm
  sink <- getUnseqSink
  sink [iem]
