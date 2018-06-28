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
    writeSeqEvents,
    HasUnseqSink(..),
    HasSeqSink(..),
    emitKafkaTransactions,
    emitKafkaBlock,
    emitKafkaChainDetails
) where

import           Conduit
import           Data.Void
import           Data.Binary                (Binary, decode, encode)

import           Blockchain.Data.BlockDB
import           Blockchain.Data.Transaction
import qualified Blockchain.Data.TXOrigin              as Origin
import           Blockchain.KafkaTopics     (lookupTopic)
import           Blockchain.Sequencer.Event
import           Blockchain.Stream.Raw
import           Blockchain.Util

import qualified Data.ByteString.Lazy       as BL
import qualified Network.Kafka              as K
import qualified Network.Kafka.Producer     as KW
import qualified Network.Kafka.Protocol     as KP

unseqEventsTopicName :: KP.TopicName
unseqEventsTopicName = lookupTopic "unseqevents"

seqEventsTopicName :: KP.TopicName
seqEventsTopicName = lookupTopic "seqevents"

assertTopicCreation :: K.Kafka k => k ()
assertTopicCreation = do
    K.updateMetadata unseqEventsTopicName
    K.updateMetadata seqEventsTopicName

readUnseqEvents :: K.Kafka k => KP.Offset -> k [IngestEvent]
readUnseqEvents = readUnseqEventsFromTopic unseqEventsTopicName

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
readFromTopic' topic offset = do
  _ <- setDefaultKafkaState
  bytes <- fetchBytes topic offset
  return $ map (decode . BL.fromStrict) bytes
  --  map (decode . BL.fromStrict) <$> fetchBytes topic offset
{-# INLINE readFromTopic' #-}

class HasUnseqSink k where
  getUnseqSink :: k (Conduit [IngestEvent] k Void)

class HasSeqSink k where
  getSeqSink :: k (Conduit [OutputEvent] k Void)

emitKafkaTransactions :: (MonadIO m, HasUnseqSink m) => Origin.TXOrigin -> [Transaction] -> m ()
emitKafkaTransactions origin txs = do
    ts <- liftIO getCurrentMicrotime
    let ingestTxs = IETx ts . IngestTx origin <$> txs
    sink <- getUnseqSink
    runConduit (yield ingestTxs .| sink)

emitKafkaBlock :: (Monad m, HasUnseqSink m) => Origin.TXOrigin -> Block -> m ()
emitKafkaBlock origin baseBlock = do
    let ingestBlock = IEBlock $ blockToIngestBlock origin baseBlock
    sink <- getUnseqSink
    runConduit (yield [ingestBlock] .| sink)

emitKafkaChainDetails :: (MonadIO m, K.HasKafkaState m, MonadLogger m) => Origin.TXOrigin -> Word256 -> ChainInfo -> m ()
emitKafkaChainDetails origin chainId details = do
    let ingestGenesis = IEGenesis (IngestGenesis origin (chainId, details))
    void . withKafkaViolently $ writeUnseqEvents [ingestGenesis]
