{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Sequencer.Kafka
  ( assertSequencerTopicsCreation,
    unseqEventsTopicName,
    seqVmTasksTopicName,
    seqP2pEventsTopicName,
    writeUnseqEvents,
    writeSeqVmTasks,
    writeSeqP2pEvents,
    writeSeqEvents,
    writeSeqEncoded,
    encodeSeqP2pEvents,
    encodeSeqVmTasks,
    emitBlockstanbulMsg,
  )
where

import qualified Blockchain.Blockstanbul as PBFT
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka.Metrics
import Control.Monad.Change.Modify (Outputs (..))
import Control.Monad.Composable.Streaming
import Data.Binary (encode)
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import Control.Monad.IO.Class (MonadIO)


unseqEventsTopicName :: TopicName
unseqEventsTopicName = "unseqevents"

seqVmTasksTopicName :: TopicName
seqVmTasksTopicName = "vm_tasks"

seqP2pEventsTopicName :: TopicName
seqP2pEventsTopicName = "seq_p2p_events"

assertSequencerTopicsCreation :: HasStreaming m => m ()
assertSequencerTopicsCreation = do
  createTopicAndWait unseqEventsTopicName
  createTopicAndWait seqVmTasksTopicName
  createTopicAndWait seqP2pEventsTopicName

writeUnseqEvents :: HasStreaming k => [IngestEvent] -> k [ProduceResponse]
writeUnseqEvents events = do
  produceItems unseqEventsTopicName events

writeSeqVmTasks :: HasStreaming k => [VmTask] -> k [ProduceResponse]
writeSeqVmTasks events = do
  recordEvents seqVMWrites events
  produceItems seqVmTasksTopicName events

writeSeqP2pEvents :: HasStreaming k => [P2pEvent] -> k [ProduceResponse]
writeSeqP2pEvents events = do
  recordEvents seqP2PWrites events
  produceItems seqP2pEventsTopicName events

-- | Write both sequencer output topics in ONE Kafka request.
--
-- Committing a block emits a P2pBlock and a VmBlock, and writing them with two
-- 'produceItems' calls costs two synchronous acks=all round trips per block —
-- measured at ~90% of the sequencer's wall clock during historic replay.
-- They are independent topics, so there is no ordering reason to send them
-- separately.
writeSeqEvents :: HasStreaming k => [P2pEvent] -> [VmTask] -> k [ProduceResponse]
writeSeqEvents p2pEvents vmTasks = do
  p2pRaw <- encodeSeqP2pEvents p2pEvents
  vmRaw <- encodeSeqVmTasks vmTasks
  writeSeqEncoded p2pRaw vmRaw

-- | Encode sequencer output ahead of a batched produce, recording the same
-- metrics the unbatched write would. Encoding at accumulation time (rather
-- than at flush time) is deliberate: it turns a block's object graph into a
-- flat ByteString so the block itself can be collected while the rest of the
-- batch is still being built.
encodeSeqP2pEvents :: MonadIO m => [P2pEvent] -> m [B.ByteString]
encodeSeqP2pEvents events = do
  recordEvents seqP2PWrites events
  return $ BL.toStrict . encode <$> events

encodeSeqVmTasks :: MonadIO m => [VmTask] -> m [B.ByteString]
encodeSeqVmTasks events = do
  recordEvents seqVMWrites events
  return $ BL.toStrict . encode <$> events

-- | Write already-encoded payloads for both sequencer topics in one request.
writeSeqEncoded :: HasStreaming k => [B.ByteString] -> [B.ByteString] -> k [ProduceResponse]
writeSeqEncoded p2pRaw vmRaw =
  produceToTopics
    [ (seqP2pEventsTopicName, p2pRaw),
      (seqVmTasksTopicName, vmRaw)
    ]

emitBlockstanbulMsg :: (m `Outputs` [IngestEvent]) => PBFT.WireMessage -> m ()
emitBlockstanbulMsg wm = output [IEBlockstanbul wm]
