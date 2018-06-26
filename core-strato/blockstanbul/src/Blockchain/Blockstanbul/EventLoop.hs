module Blockchain.Blockstanbul.EventLoop where

import Conduit

import Blockchain.Data.BlockDB
import Blockchain.Blockstanbul.Messages
import Blockchain.Blockstanbul.StateMachine

type StateMachineM m = (MonadIO m)

eventLoop :: (StateMachineM m) => Conduit WireMessage m WireMessage
eventLoop = do
  wm' <- await
  case wm' of
    Nothing -> return ()
    Just (Preprepare ri pp) -> yield (Prepare ri (blockHash pp)) >> eventLoop
    Just (Prepare ri di) -> yield (Commit ri di) >> eventLoop
    Just (Commit ri _) -> yield (RoundChange (roundidRound ri + 1)) >> eventLoop
    Just (RoundChange _) -> return ()
