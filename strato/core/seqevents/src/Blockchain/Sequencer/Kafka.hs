{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeOperators #-}
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
    emitKafkaTransactions,
    emitKafkaBlock,
    emitKafkaChainDetails,
    emitBlockstanbulMsg
) where

import           Conduit
import           Control.Monad.Change.Modify (Outputs(..))
import           Data.Binary                (Binary, decode, encode)

import qualified Blockchain.Blockstanbul as PBFT
import           Blockchain.Data.Block
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.Transaction
import qualified Blockchain.Data.TXOrigin              as Origin
import           Blockchain.KafkaTopics     (lookupTopic)
import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Kafka.Metrics
import           Blockchain.Strato.Model.ExtendedWord  (Word256)
import           Blockchain.Strato.Model.MicroTime
import           Blockchain.Stream.Raw

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
readUnseqEvents off = do
  events <- readUnseqEventsFromTopic unseqEventsTopicName off
  recordEvents unseqReads events
  return events

readUnseqEventsFromTopic :: K.Kafka k => KP.TopicName -> KP.Offset -> k [IngestEvent]
readUnseqEventsFromTopic = readFromTopic'
{-# INLINE readUnseqEventsFromTopic #-}

readSeqVmEvents :: K.Kafka k => KP.Offset -> k [VmEvent]
readSeqVmEvents off = do
  events <- readSeqVmEventsFromTopic seqVmEventsTopicName off
  recordEvents seqVMReads events
  return events

readSeqVmEventsFromTopic :: K.Kafka k => KP.TopicName -> KP.Offset -> k [VmEvent]
readSeqVmEventsFromTopic = readFromTopic'
{-# INLINE readSeqVmEventsFromTopic #-}

readSeqP2pEvents :: K.Kafka k => KP.Offset -> k [P2pEvent]
readSeqP2pEvents off = do
  events <- readSeqP2pEventsFromTopic seqP2pEventsTopicName off
  recordEvents seqP2PReads events
  return events

readSeqP2pEventsFromTopic :: K.Kafka k => KP.TopicName -> KP.Offset -> k [P2pEvent]
readSeqP2pEventsFromTopic = readFromTopic'
{-# INLINE readSeqP2pEventsFromTopic #-}

writeUnseqEvents :: K.Kafka k => [IngestEvent] -> k [KP.ProduceResponse]
writeUnseqEvents events = do
  recordEvents unseqWrites events
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

readFromTopic' :: (Binary b, K.Kafka k) => KP.TopicName -> KP.Offset -> k [b]
readFromTopic' topic offset = do
  _ <- setDefaultKafkaState
  bytes <- fetchBytes topic offset
  return $ map (decode . BL.fromStrict) bytes
  --  map (decode . BL.fromStrict) <$> fetchBytes topic offset
{-# INLINE readFromTopic' #-}

emitKafkaTransactions :: (MonadIO m, m `Outputs` [IngestEvent])
                      => Origin.TXOrigin
                      -> [Transaction]
                      -> m ()
emitKafkaTransactions origin txs = do
    ts <- liftIO getCurrentMicrotime
    let ingestTxs = IETx ts . IngestTx origin <$> txs
    output ingestTxs

emitKafkaBlock :: (m `Outputs` [IngestEvent])
               => Origin.TXOrigin -> Block -> m ()
emitKafkaBlock origin baseBlock = do
    let ingestBlock = IEBlock $ blockToIngestBlock origin baseBlock
    output [ingestBlock]

emitKafkaChainDetails :: (m `Outputs` [IngestEvent]) => Origin.TXOrigin -> Word256 -> ChainInfo -> m ()
emitKafkaChainDetails origin chainId details = do
    let ingestGenesis = IEGenesis (IngestGenesis origin (chainId, details))
    output [ingestGenesis]

emitBlockstanbulMsg :: (m `Outputs` [IngestEvent]) => PBFT.WireMessage -> m ()
emitBlockstanbulMsg wm = output [IEBlockstanbul wm]
