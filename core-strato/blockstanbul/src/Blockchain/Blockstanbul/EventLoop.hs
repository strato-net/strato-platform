{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
module Blockchain.Blockstanbul.EventLoop where

import Conduit
import Control.Monad.State.Class

import Blockchain.Data.BlockDB
import Blockchain.Blockstanbul.Messages

type StateMachineM m = (MonadIO m, MonadState BlockstanbulContext m)

data BlockstanbulContext = BlockstanbulContext {
  roundId :: RoundId
}


eventLoop :: (StateMachineM m) => Conduit BlockstanbulEvent m BlockstanbulEvent
eventLoop = do
  wm' <- await
  case wm' of
    Nothing -> return ()
    Just (Preprepare ri pp) -> yield (Prepare ri (blockHash pp)) >> eventLoop
    Just (Prepare ri di) -> yield (Commit ri di) >> eventLoop
    Just (Commit ri _) -> yield (RoundChange (roundidRound ri + 1)) >> eventLoop
    Just (RoundChange _) -> return ()
    Just Timeout -> do
      ri <- gets (roundidRound . roundId)
      yield . RoundChange . (+1) $ ri
      eventLoop
    Just (CommitFailure _) -> do
      ri <- gets (roundidRound . roundId)
      yield . RoundChange . (+1) $ ri
      eventLoop
