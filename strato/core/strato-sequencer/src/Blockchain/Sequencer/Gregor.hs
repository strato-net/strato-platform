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
    runGregorM,
    assertSequencerTopicsCreation,
    initializeCheckpoint,
  )
where

import BlockApps.Logging
import Blockchain.Blockstanbul (Checkpoint (..), decodeCheckpoint, encodeCheckpoint)
import qualified Blockchain.EthConf as EC
import Blockchain.Sequencer.CablePackage
import Blockchain.Sequencer.Event
import qualified Blockchain.Sequencer.Kafka as SK
import Blockchain.Strato.Model.Validator
import Control.Lens hiding (op)
import Control.Monad
import Control.Monad.Composable.Base
import Control.Monad.Composable.Kafka (KafkaM, HasKafka, runKafkaM, KafkaClientId, KafkaAddress, execKafka)
import qualified Control.Monad.Composable.Kafka as Kafka
import Control.Monad.Trans.Reader
import Control.Monad.Trans.Resource
import Data.Default
import Data.Maybe
import Data.String
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

assertSequencerTopicsCreation :: HasKafka m => m ()
assertSequencerTopicsCreation = void $ SK.assertSequencerTopicsCreation

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


data ImOnlyUsedInSeqWriters a b c = KafkaCheckpoint c
  deriving (Foldable)

