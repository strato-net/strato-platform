-- Gregor (Samsa) is an indedpendent Monad from SequencerM, for the purpose of
-- communicating with Kafka. This can be thought of a layer above Sequencer.Kafka,
-- to abstract communication away from SequencerM. This has two immediate gains:
-- the sequencer becomes more testable as it does not require a kafka setup to run,
-- and the sequencer does not have to worry about long blocking reads from kafka
-- preventing other events from being processed.
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-unused-top-binds #-}
module Blockchain.Sequencer.Gregor
  (
    GregorConfig(..)
  , runTheGregor
  , runGregorM
  , assertTopicCreation
  , initializeCheckpoint
  , writeSeqP2pEvents
  , writeSeqVmEvents
  ) where

import           Control.Concurrent.Async.Lifted (race_)
import           Control.Concurrent.Extra (Lock, withLock, newLock)
import           Control.Concurrent.STM (orElse, flushTQueue)
import           Control.Lens               hiding (op)
import qualified Control.Monad.Change.Modify as Mod
import           Control.Monad.Extra (whenJust)
import           Control.Monad.State
import           Control.Monad.Trans.Resource
import           Data.Default
import           Data.List (partition)
import qualified Data.Text as T
import qualified Prometheus as P
import           System.IO.Unsafe
import           UnliftIO.STM

import           Blockchain.Blockstanbul (Checkpoint(..), decodeCheckpoint, encodeCheckpoint)
import qualified Blockchain.EthConf                        as EC
import qualified Blockchain.MilenaTools     as K
import           Blockchain.Output
import           Blockchain.Sequencer.CablePackage
import           Blockchain.Sequencer.Event
import qualified Blockchain.Sequencer.Kafka as SK
import           Blockchain.Sequencer.Metrics
import           Blockchain.Strato.Model.Address
import qualified Network.Kafka              as K
import qualified Network.Kafka.Protocol     as KP
import           Text.Format

data GregorConfig = GregorConfig
                  { kafkaAddress :: Maybe K.KafkaAddress
                  , kafkaClientId :: K.KafkaClientId
                  , kafkaConsumerGroup :: KP.ConsumerGroup
                  , cablePackage :: CablePackage
                  }


data GregorContext = GregorContext
                     { _gregorKafkaState :: K.KafkaState
                     , _gregorConsumerGroup :: KP.ConsumerGroup
                     , _gregorUnseq :: TQueue IngestEvent
                     , _gregorSeqP2P :: TQueue OutputEvent
                     , _gregorSeqVM :: TQueue OutputEvent
                     }
makeLenses ''GregorContext

type GregorM = StateT GregorContext (ResourceT (LoggingT IO))

convert :: GregorConfig -> GregorContext
convert GregorConfig{..} =
  let kState = case kafkaAddress of
                  Nothing -> EC.mkConfiguredKafkaState kafkaClientId
                  Just addr -> K.mkKafkaState kafkaClientId addr
  in GregorContext { _gregorKafkaState = kState
                   , _gregorConsumerGroup = kafkaConsumerGroup
                   , _gregorUnseq = unseqEvents cablePackage
                   , _gregorSeqP2P = seqP2PEvents cablePackage
                   , _gregorSeqVM = seqVMEvents cablePackage
                   }

runGregorM :: GregorConfig -> GregorM a -> IO a
runGregorM cfg = runGregorM' (convert cfg)

runGregorM' :: GregorContext -> GregorM a -> IO a
runGregorM' ctx = runLoggingT
                . runResourceT
                . flip evalStateT ctx

instance Mod.Modifiable K.KafkaState GregorM where
  get _ = use gregorKafkaState
  put _ = assign gregorKafkaState

getKafkaConsumerGroup :: GregorM KP.ConsumerGroup
getKafkaConsumerGroup = use gregorConsumerGroup

readUnseqEvents' :: GregorM (KP.Offset, [IngestEvent])
readUnseqEvents' = do
    offset <- getNextIngestedOffset
    $logInfoS "readUnseqEvents'" . T.pack $ "Fetching unseqevents from " ++ show offset
    ret <- K.withKafkaRetry1s $ SK.readUnseqEvents offset
    let count = length ret
    P.unsafeAddCounter gregorUnseqRead $ fromIntegral count
    return (offset + fromIntegral count, ret)

writeSeqVmEvents :: [OutputEvent] -> GregorM ()
writeSeqVmEvents events = do
    void $ K.withKafkaRetry1s (SK.writeSeqVmEvents events)
    P.unsafeAddCounter gregorVMWrite (fromIntegral(length events))

writeSeqP2pEvents :: [OutputEvent] -> GregorM ()
writeSeqP2pEvents events = do
    void $ K.withKafkaRetry1s (SK.writeSeqP2pEvents events)
    P.unsafeAddCounter gregorP2PWrite (fromIntegral(length events))

assertTopicCreation :: GregorM ()
assertTopicCreation = void $ K.withKafkaViolently SK.assertTopicCreation

getNextIngestedOffset :: GregorM KP.Offset
getNextIngestedOffset = fst <$> getNextOffsetAndMetadata

encodeMeta :: Checkpoint -> KP.Metadata
encodeMeta = KP.Metadata . KP.KString . encodeCheckpoint

decodeMeta :: KP.Metadata -> Either String Checkpoint
decodeMeta (KP.Metadata (KP.KString bs)) = decodeCheckpoint bs

getNextOffsetAndMetadata :: GregorM (KP.Offset, KP.Metadata)
getNextOffsetAndMetadata = do
  group  <- getKafkaConsumerGroup
  ret <- K.withKafkaRetry1s (K.fetchSingleOffset group SK.unseqEventsTopicName 0) >>= \case
    Left KP.UnknownTopicOrPartition -> -- we've never committed an Offset
        setNextOffsetAndMetadata 0 (encodeMeta def) >> getNextOffsetAndMetadata
    Left err -> error $ "Unexpected response when fetching offset for " ++ show SK.unseqEventsTopicName ++ ": " ++ show err
    Right om -> return om
  P.incCounter gregorKafkaCheckpointReads
  return ret

setNextOffsetAndMetadata :: KP.Offset -> KP.Metadata -> GregorM ()
setNextOffsetAndMetadata newOffset newMeta = do
    group  <- getKafkaConsumerGroup
    $logInfoS "setNextIngestedOffset" . T.pack $ "Setting checkpoint to " ++ show newOffset
    P.incCounter gregorKafkaCheckpointWrites
    P.setGauge gregorUnseqOffset (fromIntegral newOffset)
    op <- K.withKafkaViolently $ K.commitSingleOffset group SK.unseqEventsTopicName 0 newOffset newMeta
    op & \case
        Left err ->
            error $ "Unexpected response when setting the offset to " ++ show newOffset ++ ": " ++ show err
        Right () -> return ()

runTheGregor :: GregorConfig -> IO ()
runTheGregor cfg = race_ (runGregorM cfg unseqReader)
                         (runGregorM cfg seqWriters)

-- When a checkpoint already exists, the arguments are ignored. They might
-- be stale if the validator pool has expanded.
initializeCheckpoint :: [Address] -> [Address] -> GregorM Checkpoint
initializeCheckpoint vals admins = do
  meta <- snd <$> getNextOffsetAndMetadata
  case decodeMeta meta of
       Left err -> do
         $logErrorS "initializeCheckpoint" . T.pack $
             "unable to decode pbft checkpoint " ++ show err
         return def{checkpointValidators=vals, checkpointAdmins=admins}
       Right kafkaCkpt -> return kafkaCkpt


unseqReader :: GregorM ()
unseqReader = forever . timeAction gregorUnseqTiming $ do
  (nextOff, inEvents) <- readUnseqEvents'
  P.withLabel gregorLoop "unseq_events" P.incCounter
  $logInfoS "gregor" . T.pack $ "Fetched " ++ show (length inEvents) ++ " unseq events"
  ch <- use gregorUnseq
  atomically . forM_ inEvents $ writeTQueue ch
  hd <- atomically $ tryPeekTQueue ch
  $logDebugS "gregor/unseqchHead" $ maybe "empty" (T.pack . format) hd
  P.unsafeAddCounter gregorUnseqWrite (fromIntegral (length inEvents))
  -- TODO: This should only really be set by the writer, i.e. once
  -- the results are committed to seq_.*_events. The reader should use
  -- an internal offset to detirmine the read start. However, with
  -- asynchronous readers and writers its difficult to correlate offsets
  -- with the events that `seqWriters` processes.
  updateOffset_locked nextOff

seqWriters :: GregorM ()
seqWriters = forever . timeAction gregorSeqTiming $ do
  vmq <- use gregorSeqVM
  p2pq <- use gregorSeqP2P
  events <- atomically $
    fmap Left (blockFlushTQueue vmq) `orElse` fmap Right (blockFlushTQueue p2pq)
  $logDebugS "gregor/seqWriter" . T.pack . show $ length events
  case events of
    Left vmevs -> do
      P.withLabel gregorLoop "seq_vm_events" P.incCounter
      P.unsafeAddCounter gregorVMRead (fromIntegral $ length vmevs)
      let isCheckpoint OENewCheckpoint{} = True
          isCheckpoint _ = False
          safeLast [] = Nothing
          safeLast [x] = Just x
          safeLast (_:xs) = safeLast xs
          (ckpts, vmevs') = partition isCheckpoint vmevs
      writeSeqVmEvents vmevs'
      whenJust (safeLast ckpts) $ \case
        OENewCheckpoint ckpt -> do
          $logDebugLS "gregor/seqWriter/checkpoint" ckpt
          P.incCounter gregorCheckpointsSent
          updateMetadata_locked $ encodeMeta ckpt
        oe -> error $ "non-checkpoint partitioned with checkpoints: " ++ show oe -- we untyped now

    Right p2pevs -> do
      P.withLabel gregorLoop "seq_p2p_events" P.incCounter
      P.unsafeAddCounter gregorP2PRead (fromIntegral $ length p2pevs)
      writeSeqP2pEvents p2pevs

-- Will only read if at least one element is in the queue.
blockFlushTQueue :: TQueue a -> STM [a]
blockFlushTQueue ch = do
  first <- readTQueue ch
  rest <- flushTQueue ch
  return $ first:rest

{-# NOINLINE unseqEventsLock #-}
unseqEventsLock :: Lock
unseqEventsLock = unsafePerformIO newLock

updateOffset_locked :: KP.Offset -> GregorM ()
updateOffset_locked off = do
  ctx <- get
  -- This is unsafe in that the state changes made in the runGregorM' will be discarded.
  -- For now, only the KafkaState would be mutated and that is okay.
  liftIO . withLock unseqEventsLock . runGregorM' ctx $ do
    (_, meta) <- getNextOffsetAndMetadata
    setNextOffsetAndMetadata off meta

updateMetadata_locked :: KP.Metadata -> GregorM ()
updateMetadata_locked meta = do
  ctx <- get
  -- This is unsafe in that the state changes made in the runGregorM' will be discarded.
  -- For now, only the KafkaState would be mutated and that is okay.
  liftIO . withLock unseqEventsLock . runGregorM' ctx $ do
    (off, _) <- getNextOffsetAndMetadata
    setNextOffsetAndMetadata off meta
