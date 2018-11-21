{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Metrics ( recordEvent
                          , recordMessage
                          , recordGossipRNG
                          , recordGossipFinal
                          , recordHashLocksSize
                          , recordLockGrabAttempt
                          ) where

import Control.Monad
import Control.Monad.IO.Class
import Data.Text
import Prometheus

import Blockchain.EventModel
import Blockchain.Data.Wire
import qualified Blockchain.Blockstanbul as PBFT

-- TODO(tim): Add peer to labels
{-# NOINLINE receivedMessages #-}
receivedMessages :: Vector Text Counter
receivedMessages = unsafeRegister
                 . vector "message_type"
                 . counter
                 $ Info "p2p_recv" "Count of inbound p2p messages"

-- TODO(tim): Add peer to labels
{-# NOINLINE sentMessages #-}
sentMessages :: Vector Text Counter
sentMessages = unsafeRegister
             . vector "message_type"
             . counter
             $ Info "p2p_sent" "Count of outbound p2p messages"

{-# NOINLINE p2pEvents #-}
p2pEvents :: Vector Text Counter
p2pEvents = unsafeRegister
          . vector "event_type"
          . counter
          $ Info "p2p_event" "Count of p2p events"

{-# NOINLINE hashLocksBlocks #-}
hashLocksBlocks :: Vector Text Counter
hashLocksBlocks = unsafeRegister
                . vector "result"
                . counter
                $ Info "p2p_hash_locks_blocks" "Results of lock grab attempts"

{-# NOINLINE hashLocksSize #-}
hashLocksSize :: Gauge
hashLocksSize = unsafeRegister
              . gauge
              $ Info "p2p_hash_locks_size" "Number of unpurged locks (may have expired)"

recordEvent :: (MonadIO m) => Event -> m ()
recordEvent = \case
  MsgEvt msg -> do
    liftIO $ withLabel p2pEvents "message" incCounter
    recordMessage' receivedMessages msg
  NewSeqEvent _ -> liftIO $ withLabel p2pEvents "new_seq_event" incCounter
  TimerEvt -> liftIO $ withLabel p2pEvents "timer_event" incCounter
  AbortEvt _ -> liftIO $  withLabel p2pEvents "abort_event" incCounter

recordMessage :: (MonadIO m) => Message -> m ()
recordMessage = recordMessage' sentMessages

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
                    PBFT.Preprepare{} -> "preprepare"
                    PBFT.Prepare{} -> "prepare"
                    PBFT.Commit{} -> "commit"
                    PBFT.RoundChange{} -> "round_change"
                GetChainDetails _ -> "get_chain_details"
                ChainDetails _ -> "chain_details"
                GetTransactions _ -> "get_transactions"
  liftIO $ withLabel msgVect label incCounter

{-# NOINLINE gossipDecisions #-}
gossipDecisions :: Vector Text Counter
gossipDecisions = unsafeRegister
                . vector "decision"
                . counter
                $ Info "p2p_gossip_decisions" "Count of approves and rejects for gossip"

recordGossipRNG :: (MonadIO m) => Bool -> m Bool
recordGossipRNG dec = liftIO $ do
  withLabel gossipDecisions (if dec then "approve" else "reject") incCounter
  return $! dec

recordGossipFinal :: (MonadIO m) => Bool -> m Bool
recordGossipFinal dec = liftIO $ do
  withLabel gossipDecisions (if dec then "approve_final" else "reject_final") incCounter
  return $! dec

recordHashLocksSize :: MonadIO m => Int -> m ()
recordHashLocksSize = liftIO . setGauge hashLocksSize . fromIntegral

recordLockGrabAttempt :: MonadIO m => Int -> Int -> m ()
recordLockGrabAttempt success total = liftIO $ do
  let add l n = withLabel hashLocksBlocks l $ void . flip addCounter (fromIntegral n)
  add "success" success
  add "total" total
  add "blocked" (total - success)
