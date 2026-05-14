{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Slipstream.Metrics
  ( recordKafkaMessages,
  )
where

import Control.Monad
import Control.Monad.IO.Class
import Prometheus

{-# NOINLINE kafkaCount #-}
kafkaCount :: Counter
kafkaCount =
  unsafeRegister
    . counter
    $ Info "slipstream_kafka_read" "Number of messages read from kafka"

recordKafkaMessages :: MonadIO m => [a] -> m ()
recordKafkaMessages = liftIO . void . addCounter kafkaCount . fromIntegral . length
