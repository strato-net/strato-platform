{-# LANGUAGE OverloadedStrings     #-}

module Blockchain.SeqEventNotify (
  seqEventNotificationSource
  ) where

import           Conduit
import           Control.Monad.Composable.Kafka
import qualified Network.Kafka                    as K
import           BlockApps.Logging                as BL
import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Kafka (seqP2pEventsTopicName)

seqEventNotificationSource :: (MonadIO m, MonadLogger m) =>
                              K.KafkaState -> ConduitM () P2pEvent m ()
seqEventNotificationSource kafkaState = do
  kafkaEnv <- kafkaStateToKafkaEnv kafkaState
  conduitSourceUsingEnv "seqEventNotificationSource" kafkaEnv seqP2pEventsTopicName
