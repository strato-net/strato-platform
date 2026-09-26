{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TemplateHaskell       #-}

-- | Delivery of sequencer events (transactions, blocks and Blockstanbul
-- messages to gossip) to the peer connections.
--
-- The sequencer publishes to the @seq_p2p_events@ topic. Every peer
-- connection must see every event, so the topic is consumed exactly once per
-- process by 'runSeqEventBroadcaster' and fanned out in memory through a
-- broadcast 'TChan'. Each connection calls 'subscribeSeqEvents' when it starts
-- and receives the events published from that moment on.
--
-- Historically every connection ran its own 'conduitBatchSource'. That was
-- fine on the Kafka backend, where each instance tracked its own in-memory
-- offset starting at the latest message. On the JLog backend all instances
-- that share the "strato-p2p" client id share one durable subscriber
-- checkpoint, so they competed for messages: each event reached a single
-- peer, and was lost outright when that connection was torn down before
-- handling it (unpropagated transactions, slow consensus rounds).
module Blockchain.SeqEventNotify (
  SeqEventBroadcast,
  newSeqEventBroadcast,
  runSeqEventBroadcaster,
  subscribeSeqEvents,
  seqEventNotificationSource
  ) where

import           BlockApps.Logging
import           Blockchain.EthConf (ethConf)
import           Blockchain.EthConf.Model (streamingConfig, streamingHost, streamingPort)
import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Kafka (seqP2pEventsTopicName)
import           Blockchain.Threads (labelTheThread)
import           Conduit
import           Control.Monad (forever)
import           Control.Monad.Composable.Streaming
import           Data.String (fromString)
import qualified Data.Text as T
import           UnliftIO.Concurrent (threadDelay)
import           UnliftIO.Exception (SomeException, try)
import           UnliftIO.STM

-- | Process-wide fan-out point for sequencer events.
newtype SeqEventBroadcast = SeqEventBroadcast (TChan P2pEvent)

newSeqEventBroadcast :: MonadIO m => m SeqEventBroadcast
newSeqEventBroadcast = SeqEventBroadcast <$> newBroadcastTChanIO

-- | The raw @seq_p2p_events@ stream. It carries the process's durable
-- subscription, so it must run at most once per process: use
-- 'runSeqEventBroadcaster' and 'subscribeSeqEvents' rather than running it
-- per connection.
seqEventNotificationSource :: MonadIO m =>
                              ConduitM () P2pEvent m ()
seqEventNotificationSource =
  let k = streamingConfig ethConf
  in conduitBatchSource "strato-p2p" (fromString $ streamingHost k, fromIntegral $ streamingPort k) seqP2pEventsTopicName
       .| concatMapC id

-- | Consume the topic once and publish every event to all subscribers. Never
-- returns; if the underlying stream fails it is logged and reopened.
runSeqEventBroadcaster :: SeqEventBroadcast -> IO ()
runSeqEventBroadcaster (SeqEventBroadcast chan) =
  labelTheThread "seqEventBroadcaster" . forever $ do
    result <- try . runConduit $
      seqEventNotificationSource .| mapM_C (atomically . writeTChan chan)
    runLoggingT $ case result of
      Left (e :: SomeException) ->
        $logErrorS "seqEventBroadcaster" . T.pack $
          "sequencer event stream failed, reopening in 1s: " ++ show e
      Right () ->
        $logErrorS "seqEventBroadcaster" "sequencer event stream ended, reopening in 1s"
    threadDelay 1000000

-- | Subscribe a peer connection. The returned source yields every event
-- published after this call, mirroring the latest-offset start of the Kafka
-- era source. A subscription that is dropped unread costs nothing once it is
-- unreachable; one that is kept but not read retains the events published
-- since, so run it for the lifetime of the connection only.
subscribeSeqEvents :: (MonadIO m, MonadIO n) => SeqEventBroadcast -> m (ConduitM () P2pEvent n ())
subscribeSeqEvents (SeqEventBroadcast chan) = do
  mine <- atomically $ dupTChan chan
  pure . repeatMC . atomically $ readTChan mine
