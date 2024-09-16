-- Gregor (Samsa) is an indedpendent Monad from SequencerM, for the purpose of
-- communicating with Kafka. This can be thought of a layer above Sequencer.Kafka,
-- to abstract communication away from SequencerM. This has two immediate gains:
-- the sequencer becomes more testable as it does not require a kafka setup to run,
-- and the sequencer does not have to worry about long blocking reads from kafka
-- preventing other events from being processed.
{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DeriveFoldable #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Sequencer.Gregor
  ( GregorConfig (..),
    runTheGregor,
    runGregorM,
    assertSequencerTopicsCreation,
    initializeCheckpoint,
    updateMetadata_locked
  )
where

import BlockApps.Logging
import Blockchain.Blockstanbul (Checkpoint (..), decodeCheckpoint, encodeCheckpoint)
import qualified Blockchain.EthConf as EC
import Blockchain.Sequencer.CablePackage
import Blockchain.Sequencer.Event
import qualified Blockchain.Sequencer.Kafka as SK
import Blockchain.Sequencer.Metrics
import Blockchain.Strato.Model.Validator
import Control.Concurrent.Async.Lifted (race_)
import Control.Concurrent.Extra (Lock, newLock, withLock)
import Control.Concurrent.STM (flushTQueue)
import Control.Lens hiding (op)
import Control.Monad
import Control.Monad.Composable.Base
import Control.Monad.Composable.Kafka (KafkaM, HasKafka, KafkaEnv(..), runKafkaM, runKafkaMUsingEnv, KafkaClientId, KafkaAddress, execKafka)
import qualified Control.Monad.Composable.Kafka as Kafka
import Control.Monad.IO.Class
import Control.Monad.Trans.Reader
import Control.Monad.Trans.Resource
import Data.Default
import Data.Foldable (for_)
import Data.List.Extra (chunksOf)
import Data.Maybe
import Data.String
import qualified Data.Text as T
import qualified Prometheus as P
import System.IO.Unsafe
import Text.Format
import UnliftIO.STM

data GregorConfig = GregorConfig
  { kafkaAddress :: Maybe KafkaAddress,
    kafkaClientId :: KafkaClientId,
    kafkaConsumerGroup :: Kafka.ConsumerGroup,
    cablePackage :: CablePackage
  }

data GregorContext = GregorContext
  { _gregorConsumerGroup :: Kafka.ConsumerGroup,
    _gregorUnseq :: TBQueue IngestEvent,
    _gregorUnseqCheckpoints :: TQueue Checkpoint
  }

type GregorM = ReaderT GregorContext

type HasGregorContext m = AccessibleEnv GregorContext m

convert :: GregorConfig -> GregorContext
convert GregorConfig {..} =
    GregorContext
        { _gregorConsumerGroup = kafkaConsumerGroup,
          _gregorUnseq = unseqEvents cablePackage,
          _gregorUnseqCheckpoints = unseqCheckpoints cablePackage
        }

runGregorM :: MonadUnliftIO m =>
              GregorConfig -> KafkaM (GregorM (ResourceT (LoggingT m))) a -> m a
runGregorM cfg = do
  let ethConf' = EC.kafkaConfig EC.ethConf
      kafkaAddress' = fromMaybe (fromString $ EC.kafkaHost ethConf', fromIntegral $ EC.kafkaPort ethConf')
                      $ kafkaAddress cfg
      
  runLoggingT
    . runResourceT
    . flip runReaderT (convert cfg :: GregorContext)
    . runKafkaM (kafkaClientId cfg) kafkaAddress'


getKafkaConsumerGroup :: (Functor m, HasGregorContext m) =>
                         m Kafka.ConsumerGroup
getKafkaConsumerGroup = fmap _gregorConsumerGroup accessEnv

readUnseqEvents' :: (MonadLogger m, P.MonadMonitor m, HasKafka m, HasGregorContext m) =>
                    m (Kafka.Offset, [IngestEvent])
readUnseqEvents' = do
  offset <- getNextIngestedOffset
  $logInfoS "readUnseqEvents'" . T.pack $ "Fetching unseqevents from " ++ show offset
  ret <- SK.readUnseqEvents offset
  let count = length ret
  P.unsafeAddCounter gregorUnseqRead $ fromIntegral count
  return (offset + fromIntegral count, ret)

assertSequencerTopicsCreation :: HasKafka m => m ()
assertSequencerTopicsCreation = void $ SK.assertSequencerTopicsCreation

getNextIngestedOffset :: (MonadLogger m, HasKafka m, HasGregorContext m) =>
                         m Kafka.Offset
getNextIngestedOffset = do
  group <- getKafkaConsumerGroup
  fst <$> getNextOffsetAndMetadata group

encodeMeta :: Checkpoint -> Kafka.Metadata
encodeMeta = Kafka.Metadata . Kafka.KString . encodeCheckpoint

decodeMeta :: Kafka.Metadata -> Either String Checkpoint
decodeMeta (Kafka.Metadata (Kafka.KString bs)) = decodeCheckpoint bs

getNextOffsetAndMetadata :: HasKafka m =>
                            Kafka.ConsumerGroup -> m (Kafka.Offset, Kafka.Metadata)
getNextOffsetAndMetadata group = do
  ret <-
    execKafka (Kafka.fetchSingleOffset group SK.unseqEventsTopicName 0) >>= \case
      Left Kafka.UnknownTopicOrPartition ->
        -- we've never committed an Offset
        setNextOffsetAndMetadata group 0 (encodeMeta def) >> getNextOffsetAndMetadata group
      Left err -> error $ "Unexpected response when fetching offset for " ++ show SK.unseqEventsTopicName ++ ": " ++ show err
      Right om -> return om
  return ret

setNextOffsetAndMetadata :: HasKafka m => Kafka.ConsumerGroup -> Kafka.Offset -> Kafka.Metadata -> m ()
setNextOffsetAndMetadata group newOffset newMeta = do
  op <- execKafka $ Kafka.commitSingleOffset group SK.unseqEventsTopicName 0 newOffset newMeta
  op & \case
    Left err ->
      error $ "Unexpected response when setting the offset to " ++ show newOffset ++ ": " ++ show err
    Right () -> return ()

runTheGregor :: GregorConfig -> IO ()
runTheGregor cfg =
  race_
    (runGregorM cfg unseqReader)
    (runGregorM cfg seqWriters)

-- When a checkpoint already exists, the arguments are ignored. They might
-- be stale if the validator pool has expanded.
initializeCheckpoint :: (MonadLogger m, HasKafka m, HasGregorContext m) =>
                        [Validator] -> m Checkpoint
initializeCheckpoint vals = do
  group <- getKafkaConsumerGroup
  meta <- snd <$> getNextOffsetAndMetadata group
  let overrideVals c = c {checkpointValidators = vals}
  $logDebugLS "initializeCheckpoint" meta
  case (meta, decodeMeta meta) of
    ("", _) -> do
      $logInfoS "initializeCheckpoint" "No checkpoint found -- starting from (0, 0)"
      return $ overrideVals def
    (_, Left err) -> error $ "corrupt metadata in initializeCheckpoint:" ++ show err
    (_, Right kafkaCkpt) ->
      if null (checkpointValidators kafkaCkpt)
        then do
          $logInfoS "initializeCheckpoint" "No validators in checkpoint -- setting by flags"
          return $ overrideVals kafkaCkpt
        else return kafkaCkpt

unseqReader :: (MonadLogger m, HasKafka m, P.MonadMonitor m, HasGregorContext m) =>
               m ()
unseqReader = forever . timeAction gregorUnseqTiming $ do
  (nextOff, inEvents) <- readUnseqEvents'
  P.withLabel gregorLoop "unseq_events" P.incCounter
  $logInfoS "gregor" . T.pack $ "Fetched " ++ show (length inEvents) ++ " unseq events"
  ch <- fmap _gregorUnseq accessEnv
  forM_ (chunksOf (fromIntegral queueDepth `div` 4) inEvents) $ \chnk -> do
    atomically . forM_ chnk $ writeTBQueue ch
    P.unsafeAddCounter gregorUnseqWrite (fromIntegral (length chnk))
  hd <- atomically $ tryPeekTBQueue ch
  $logDebugS "gregor/unseqchHead" $ maybe "empty" (T.pack . format) hd
  -- TODO: This should only really be set by the writer, i.e. once
  -- the results are committed to seq_.*_events. The reader should use
  -- an internal offset to detirmine the read start. However, with
  -- asynchronous readers and writers its difficult to correlate offsets
  -- with the events that `seqWriters` processes.
  updateOffset_locked nextOff

data ImOnlyUsedInSeqWriters a b c = KafkaCheckpoint c
  deriving (Foldable)

seqWriters :: (MonadLogger m, P.MonadMonitor m, HasKafka m, HasGregorContext m) =>
              m ()
seqWriters = forever . timeAction gregorSeqTiming $ do
  ckptq <- fmap _gregorUnseqCheckpoints accessEnv
  events <-
    atomically $ fmap KafkaCheckpoint (blockFlushTQueue ckptq)
  $logDebugS "gregor/seqWriter" . T.pack . show $ length events
  case events of
    KafkaCheckpoint ckpts -> do
      let safeLast [] = Nothing
          safeLast xs = Just $ last xs
      for_ (safeLast ckpts) $ \ckpt -> do
        $logDebugLS "gregor/seqWriter/checkpoint" ckpt
        P.incCounter gregorCheckpointsSent
        updateMetadata_locked $ encodeMeta ckpt

-- Will only read if at least one element is in the queue.
blockFlushTQueue :: TQueue a -> STM [a]
blockFlushTQueue ch = do
  first <- readTQueue ch
  rest <- flushTQueue ch
  return $ first : rest

{-# NOINLINE unseqEventsLock #-}
unseqEventsLock :: Lock
unseqEventsLock = unsafePerformIO newLock

updateOffset_locked :: (MonadLogger m, HasKafka m, HasGregorContext m) =>
                       Kafka.Offset -> m ()
updateOffset_locked off = do
  ctx <- accessEnv

  group <- getKafkaConsumerGroup

  $logInfoS "setNextIngestedOffset" . T.pack $ "Setting checkpoint to " ++ show off

  liftIO $ withLock unseqEventsLock . runKafkaMUsingEnv (KafkaEnv ctx) $ do
    (_, meta) <- getNextOffsetAndMetadata group
    setNextOffsetAndMetadata group off meta

updateMetadata_locked :: (MonadLogger m, HasKafka m, HasGregorContext m) =>
                         Kafka.Metadata -> m ()
updateMetadata_locked meta = do
  ctx <- accessEnv

  group <- getKafkaConsumerGroup

  liftIO $ withLock unseqEventsLock . runKafkaMUsingEnv (KafkaEnv ctx) $ do
    (off, _) <- getNextOffsetAndMetadata group
    setNextOffsetAndMetadata group off meta



