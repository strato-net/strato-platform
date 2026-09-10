{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Slipstream.Metrics
  ( recordKafkaMessages,
    recordProcessedKafkaMessages,
    recordOutputBatch,
    timeSlipstreamPhase,
  )
where

import Control.Monad
import Control.Monad.IO.Class
import Data.Text (Text)
import GHC.Clock (getMonotonicTimeNSec)
import Prometheus

{-# NOINLINE kafkaCount #-}
kafkaCount :: Counter
kafkaCount =
  unsafeRegister
    . counter
    $ Info "slipstream_kafka_read" "Number of messages read from kafka"

recordKafkaMessages :: MonadIO m => [a] -> m ()
recordKafkaMessages messages = liftIO $ do
  void . addCounter kafkaCount . fromIntegral $ length messages
  observe kafkaBatchSize . fromIntegral $ length messages

{-# NOINLINE processedKafkaCount #-}
processedKafkaCount :: Counter
processedKafkaCount =
  unsafeRegister
    . counter
    $ Info "slipstream_kafka_processed" "Number of Kafka messages whose database writes completed"

recordProcessedKafkaMessages :: MonadIO m => [a] -> m ()
recordProcessedKafkaMessages = liftIO . void . addCounter processedKafkaCount . fromIntegral . length

{-# NOINLINE kafkaBatchSize #-}
kafkaBatchSize :: Summary
kafkaBatchSize =
  unsafeRegister
    . flip summary defaultQuantiles
    $ Info "slipstream_kafka_batch_size" "Number of Kafka messages in each Slipstream batch"

{-# NOINLINE outputBatchSize #-}
outputBatchSize :: Vector Text Summary
outputBatchSize =
  unsafeRegister
    . vector "kind"
    . flip summary defaultQuantiles
    $ Info "slipstream_output_batch_size" "Number of generated outputs in each Slipstream batch"

recordOutputBatch :: MonadIO m => [a] -> [b] -> m ()
recordOutputBatch queries transactionResults = liftIO $ do
  withLabel outputBatchSize "cirrus_query" $ flip observe . fromIntegral $ length queries
  withLabel outputBatchSize "transaction_result" $ flip observe . fromIntegral $ length transactionResults

{-# NOINLINE phaseDuration #-}
phaseDuration :: Vector Text Summary
phaseDuration =
  unsafeRegister
    . vector "phase"
    . flip summary defaultQuantiles
    $ Info "slipstream_phase_seconds" "Wall-clock seconds spent in each Slipstream processing phase"

timeSlipstreamPhase :: MonadIO m => Text -> m a -> m a
timeSlipstreamPhase phase action = do
  start <- liftIO getMonotonicTimeNSec
  result <- action
  end <- liftIO getMonotonicTimeNSec
  liftIO . withLabel phaseDuration phase $ flip observe $ fromIntegral (end - start) / 1000000000
  pure result
