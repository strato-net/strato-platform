{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module Blockchain.Metrics
  ( recordEvent,
    recordMessage,
    addCanary,
    killCanary,
    recordException,
    recordQueuedTxs,
    recordEmptyQueue,
    recordWatchdogPet,
    recordWatchdogWake,
    recordTraffic,
  )
where

import qualified Blockchain.Blockstanbul as PBFT
import Blockchain.Data.Wire
import Blockchain.Display (MsgDirection (..))
import Blockchain.EventModel
import Blockchain.Strato.Discovery.Data.Peer (PPeer (..))
import Control.Exception
import Control.Monad.IO.Class
import qualified Data.ByteString as B
import Data.Text
import Data.Typeable
import Prometheus

-- TODO(tim): Add peer to labels
receivedMessages :: Vector Text Counter
receivedMessages =
  unsafeRegister
    . vector "message_type"
    . counter
    $ Info "p2p_recv" "Count of inbound p2p messages"

-- TODO(tim): Add peer to labels
sentMessages :: Vector Text Counter
sentMessages =
  unsafeRegister
    . vector "message_type"
    . counter
    $ Info "p2p_sent" "Count of outbound p2p messages"

p2pEvents :: Vector Text Counter
p2pEvents =
  unsafeRegister
    . vector "event_type"
    . counter
    $ Info "p2p_event" "Count of p2p events"

recordEvent :: (MonadIO m) => Event -> m ()
recordEvent = \case
  MsgEvt msg -> do
    liftIO $ withLabel p2pEvents "message" incCounter
    recordMessage' receivedMessages msg
  NewSeqEvent _ -> liftIO $ withLabel p2pEvents "new_seq_event" incCounter
  TimerEvt -> liftIO $ withLabel p2pEvents "timer_event" incCounter
  AbortEvt _ -> liftIO $ withLabel p2pEvents "abort_event" incCounter

recordMessage :: (MonadIO m) => Message -> m ()
recordMessage = recordMessage' sentMessages

recordMessage' :: (MonadIO m) => Vector Text Counter -> Message -> m ()
recordMessage' msgVect msg = do
  let label = case msg of
        Hello {} -> "hello"
        Disconnect _ -> "disconnect"
        Ping -> "ping"
        Pong -> "pong"
        Status {} -> "status"
        NewBlockHashes _ -> "new_block_hashes"
        Transactions _ -> "transactions"
        GetBlockHeaders {} -> "get_block_headers"
        BlockHeaders _ -> "block_headers"
        GetBlockBodies _ -> "get_block_bodies"
        BlockBodies _ -> "block_bodies"
        NewBlock _ _ -> "new_block"
        Blockstanbul wm ->
          case PBFT._message wm of
            PBFT.Preprepare {} -> "preprepare"
            PBFT.Prepare {} -> "prepare"
            PBFT.Commit {} -> "commit"
            PBFT.RoundChange {} -> "round_change"
        GetChainDetails _ -> "get_chain_details"
        ChainDetails _ -> "chain_details"
        GetTransactions _ -> "get_transactions"
        GetMPNodes _ -> "get_mp_nodes"
        MPNodes _ -> "mp_nodes"
  liftIO $ withLabel msgVect label incCounter

{-# NOINLINE canaryCount #-}
canaryCount :: Gauge
canaryCount =
  unsafeRegister
    . gauge
    $ Info "p2p_canary_count" "Rough approximation of the number of kafka threads running"

addCanary :: MonadIO m => m ()
addCanary = liftIO $ incGauge canaryCount

killCanary :: MonadIO m => m ()
killCanary = liftIO $ decGauge canaryCount

{-# NOINLINE exceptionCount #-}
exceptionCount :: Vector (Text, Text, Text) Counter
exceptionCount =
  unsafeRegister
    . vector ("ip", "port", "type")
    . counter
    $ Info "p2p_peer_exceptions" "Counters for exceptions thrown by peer connections"

recordException :: (Exception e, MonadIO m) => PPeer -> e -> m ()
recordException PPeer {..} e =
  let ty = pack . show $ typeOf e
      port = pack $ show pPeerTcpPort
   in liftIO $ withLabel exceptionCount (pPeerIp, port, ty) incCounter

{-# NOINLINE txQueueDepth #-}
txQueueDepth :: Gauge
txQueueDepth =
  unsafeRegister
    . gauge
    $ Info "p2p_queue_depth" "Number of queued transactions to send"

recordQueuedTxs :: MonadIO m => [a] -> m ()
recordQueuedTxs = liftIO . addGauge txQueueDepth . fromIntegral . Prelude.length

recordEmptyQueue :: MonadIO m => m ()
recordEmptyQueue = liftIO $ setGauge txQueueDepth 0

{-# NOINLINE watchdogActions #-}
watchdogActions :: Vector Text Counter
watchdogActions =
  unsafeRegister
    . vector "action"
    . counter
    $ Info "p2p_watchdog_actions" "Number of wakes/pets that the watchdog has endured"

recordWatchdogPet :: MonadIO m => m ()
recordWatchdogPet = liftIO $ withLabel watchdogActions "pet" incCounter

recordWatchdogWake :: MonadIO m => m ()
recordWatchdogWake = liftIO $ withLabel watchdogActions "wake" incCounter

{-# NOINLINE traffic #-}
traffic :: Vector (Text, Text) Counter
traffic =
  unsafeRegister
    . vector ("direction", "type")
    . counter
    $ Info "p2p_traffic" "Number and lengths of inbound/outbound messages"

recordTraffic :: MonadIO m => MsgDirection -> B.ByteString -> m ()
recordTraffic dir msg = liftIO $ do
  let dirLabel = if dir == Inbound then "recv" else "send"
  withLabel traffic (dirLabel, "count") incCounter
  withLabel traffic (dirLabel, "bytes") $ \c -> unsafeAddCounter c (fromIntegral $ B.length msg)
