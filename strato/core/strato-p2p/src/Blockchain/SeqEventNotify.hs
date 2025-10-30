{-# LANGUAGE OverloadedStrings     #-}

module Blockchain.SeqEventNotify (
  seqEventNotificationSource
  ) where

import           Conduit
import           Control.Monad.Composable.Kafka
import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Kafka (seqP2pEventsTopicName)

seqEventNotificationSource :: MonadIO m =>
                              KafkaEnv -> ConduitM () P2pEvent m ()
seqEventNotificationSource kafkaEnv = do
  conduitSourceUsingEnv kafkaEnv seqP2pEventsTopicName
