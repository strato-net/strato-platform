{-# LANGUAGE OverloadedStrings     #-}

module Blockchain.SeqEventNotify (
  seqEventNotificationSource
  ) where

import           Conduit
import           Control.Monad.Composable.Streaming
import           Blockchain.EthConf (ethConf)
import           Blockchain.EthConf.Model (streamingConfig, streamingHost, streamingPort)
import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Kafka (seqP2pEventsTopicName)
import           Data.String (fromString)

seqEventNotificationSource :: MonadIO m =>
                              ConduitM () P2pEvent m ()
seqEventNotificationSource =
  let k = streamingConfig ethConf
  in conduitBatchSource "strato-p2p" (fromString $ streamingHost k, fromIntegral $ streamingPort k) seqP2pEventsTopicName
       .| concatMapC id
