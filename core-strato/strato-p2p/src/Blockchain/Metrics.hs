{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Metrics ( recordEvent
                          , recordMessage) where

import Control.Monad.IO.Class
import Data.Text
import Prometheus

import Blockchain.EventModel
import Blockchain.Data.Wire
import qualified Blockchain.Blockstanbul as PBFT

-- TODO(tim): Add peer to labels
receivedMessages :: Vector Text Counter
receivedMessages = unsafeRegister
                 . vector "message_type"
                 . counter
                 $ Info "p2p_recv" "Count of inbound p2p messages"

-- TODO(tim): Add peer to labels
sentMessages :: Vector Text Counter
sentMessages = unsafeRegister
             . vector "message_type"
             . counter
             $ Info "p2p_sent" "Count of outbound p2p messages"

p2pEvents :: Vector Text Counter
p2pEvents = unsafeRegister
          . vector "event_type"
          . counter
          $ Info "p2p_event" "Count of p2p events"

recordEvent :: (MonadIO m) => Event -> m ()
recordEvent = \case
  MsgEvt msg -> do
    liftIO $ withLabel p2pEvents "message" incCounter
    recordMessage' sentMessages msg
  NewSeqEvent _ -> liftIO $ withLabel p2pEvents "new_seq_event" incCounter
  TimerEvt -> liftIO $ withLabel p2pEvents "timer_event" incCounter
  AbortEvt _ -> liftIO $  withLabel p2pEvents "abort_event" incCounter

recordMessage :: (MonadIO m) => Message -> m ()
recordMessage = recordMessage' receivedMessages

recordMessage' :: (MonadIO m) => Vector Text Counter -> Message -> m ()
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
  liftIO $ withLabel msgVect label incCounter
