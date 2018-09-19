{-# LANGUAGE LambdaCase #-}

module Blockchain.Metrics ( recordEvent
                          , recordMessage) where

import Prometheus
import Control.Monad.IO.Class
import Blockchain.Event
import Blockchain.Data.Wire
import qualified Blockchain.Blockstanbul as PBFT

-- TODO(tim): Add peer to labels
receivedMessages :: Metric (Vector String Counter)
receivedMessages = unsafeRegisterIO
                 . vector "message_type"
                 . counter
                 $ Info "p2p_recv" "Count of inbound p2p messages"

-- TODO(tim): Add peer to labels
sentMessages :: Metric (Vector String Counter)
sentMessages = unsafeRegisterIO
             . vector "message_type"
             . counter
             $ Info "p2p_sent" "Count of outbound p2p messages"

p2pEvents :: Metric (Vector String Counter)
p2pEvents = unsafeRegisterIO
          . vector "event_type"
          . counter
          $ Info "p2p_event" "Count of p2p events"

recordEvent :: (MonadIO m) => Event -> m ()
recordEvent = \case
  MsgEvt msg -> do
    liftIO $ withLabel "message" incCounter p2pEvents
    recordMessage' sentMessages msg
  NewSeqEvent _ -> liftIO $ withLabel "new_seq_event" incCounter p2pEvents
  TimerEvt -> liftIO $ withLabel "timer_event" incCounter p2pEvents
  AbortEvt _ -> liftIO $  withLabel "abort_event" incCounter p2pEvents

recordMessage :: (MonadIO m) => Message -> m ()
recordMessage = recordMessage' receivedMessages

recordMessage' :: (MonadIO m) => Metric (Vector String Counter) -> Message -> m ()
recordMessage' msgVect msg = do
  let label = case msg of
                Hello{} -> "hello"
                Disconnect _ -> "disconnect"
                Ping -> "ping"
                Pong -> "pong"
                Status{} -> "status"
                NewBlockHashes _ -> "new_block_hashes"
                Transactions _ -> "transactions"
                GetBlockHeaders{} -> "get_block_headers"
                BlockHeaders _ -> "block_headers"
                GetBlockBodies _ -> "get_block_bodies"
                BlockBodies _ -> "block_bodies"
                NewBlock _ _ -> "new_block"
                Blockstanbul wm ->
                  case PBFT._message wm of
                    PBFT.Preprepare _ _ -> "preprepare"
                    PBFT.Prepare _ _ -> "prepare"
                    PBFT.Commit _ _ _ -> "commit"
                    PBFT.RoundChange _ -> "round_change"
                GetChainDetails _ -> "get_chain_details"
                ChainDetails _ -> "chain_details"
                GetTransactions _ -> "get_transactions"
  liftIO $ withLabel label incCounter msgVect
