{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
module Blockchain.Blockstanbul.EventLoop where

import Conduit
import Control.Monad
import Control.Monad.State.Class

import Blockchain.Data.BlockDB
import Blockchain.Blockstanbul.Messages

type StateMachineM m = (MonadIO m, MonadState BlockstanbulContext m)

data BlockstanbulContext = BlockstanbulContext {
  -- roundId describes which consensus round is under consideration.
  roundId :: RoundId

  -- validator authenticates wire messages are coming from the right sender
  , validator :: BlockstanbulEvent -> Bool
}

roundChange :: (StateMachineM m) => Conduit BlockstanbulEvent m BlockstanbulEvent
roundChange = do
  ri <- gets (roundidRound . roundId)
  yield . RoundChange (error "TODO(tim): supply a private key to StateMachineM") . (+1) $ ri

eventLoop :: (StateMachineM m) => Conduit BlockstanbulEvent m BlockstanbulEvent
eventLoop = do
  wm' <- await
  valid <- gets validator
  case wm' of
    Nothing -> return ()
    Just msg@(Preprepare auth ri pp) -> when (valid msg) $ do
      yield (Prepare auth ri (blockHash pp))
      eventLoop
    Just msg@(Prepare auth ri di) -> when (valid msg) $ do
      yield (Commit auth ri di)
      eventLoop
    Just msg@(Commit auth ri _) -> when (valid msg) $ do
      yield (RoundChange auth (roundidRound ri + 1))
      eventLoop
    Just msg@(RoundChange _ _) -> when (valid msg) $ do
      return ()
    Just Timeout -> roundChange >> eventLoop
    Just (CommitFailure _) -> roundChange >> eventLoop
