{-# LANGUAGE OverloadedStrings     #-}

module Blockchain.SeqEventNotify (
  seqEventNotificationSource
  ) where

import           Conduit
import           Control.Monad.Composable.Kafka
import           BlockApps.Logging                as BL
import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Kafka (seqP2pEventsTopicName)

seqEventNotificationSource :: (MonadIO m, MonadLogger m) =>
                              KafkaEnv -> ConduitM () P2pEvent m ()
seqEventNotificationSource kafkaEnv = do
  conduitSourceUsingEnv "seqEventNotificationSource" kafkaEnv seqP2pEventsTopicName
