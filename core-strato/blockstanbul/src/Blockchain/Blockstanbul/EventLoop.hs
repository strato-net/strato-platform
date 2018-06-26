{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TemplateHaskell #-}
module Blockchain.Blockstanbul.EventLoop where

import Conduit
import Control.Lens
import Control.Monad
import Control.Monad.State.Class

import Blockchain.Data.Address
import Blockchain.Data.BlockDB
import Blockchain.Blockstanbul.Messages

type StateMachineM m = (MonadIO m, MonadState BlockstanbulContext m)

data BlockstanbulContext = BlockstanbulContext {
  -- roundId describes which consensus round is under consideration.
    _roundId :: RoundId
  -- authenticator authenticates wire messages are coming from the right sender
  , _authenticator :: BlockstanbulEvent -> Bool
  -- The block proposed for this round
  , _proposal :: Maybe Block
  -- The designated participant to suggest a block for this round
  , _proposer :: Maybe Address
  -- The total group of participants
  , _validators :: [Address]

}
makeLenses ''BlockstanbulContext

roundChange :: (StateMachineM m) => Conduit BlockstanbulEvent m BlockstanbulEvent
roundChange = do
  r <- uses roundId roundidRound
  yield . RoundChange (error "TODO(tim): supply a private key to StateMachineM") . (+1) $ r

eventLoop :: (StateMachineM m) => Conduit BlockstanbulEvent m BlockstanbulEvent
eventLoop = do
  wm' <- await
  isAuthentic <- use authenticator
  case wm' of
    Nothing -> return ()
    Just msg@(Preprepare auth ri pp) -> when (isAuthentic msg) $ do
      pr <- use proposer
      when (Just (sender (auth)) == pr) $ do
        proposal .= Just pp
        yield (Prepare auth ri (blockHash pp))
      eventLoop
    Just msg@(Prepare auth ri di) -> when (isAuthentic msg) $ do
      yield (Commit auth ri di)
      eventLoop
    Just msg@(Commit auth ri _) -> when (isAuthentic msg) $ do
      yield (RoundChange auth (roundidRound ri + 1))
      eventLoop
    Just msg@(RoundChange _ _) -> when (isAuthentic msg) $ do
      return ()
    Just Timeout -> roundChange >> eventLoop
    Just (CommitFailure _) -> roundChange >> eventLoop
