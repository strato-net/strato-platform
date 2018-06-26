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

isAuthorized :: (StateMachineM m) => BlockstanbulEvent -> m Bool
isAuthorized event = case getAuth event of
    -- Timeouts and failures are trusted as they are from this node.
    Nothing -> return True
    Just (MsgAuth addr _) -> do
      authn <- use authenticator
      if not (authn event)
        then return False
        else do
          authorized <- use validators
          return $ addr `elem` authorized

roundChange :: (StateMachineM m) => Conduit BlockstanbulEvent m BlockstanbulEvent
roundChange = do
  r <- uses roundId roundidRound
  yield . RoundChange (error "TODO(tim): supply a private key to StateMachineM") . (+1) $ r

eventLoop :: (StateMachineM m) => Conduit BlockstanbulEvent m BlockstanbulEvent
eventLoop = do
  wm' <- await
  authz <- lift $ traverse isAuthorized wm'
  curRound <- use roundId
  case (authz, wm') of
    (_, Nothing) -> return ()
    (Just False, _) -> eventLoop
    (_, Just (Preprepare auth ri pp)) -> do
      pr <- use proposer
      when (Just (sender (auth)) == pr) $ do
        proposal .= Just pp
        if curRound == ri
          then yield (Prepare auth ri (blockHash pp))
          else roundChange
      eventLoop
    (_, Just (Prepare auth ri di)) -> when (curRound <= ri) $ do
      yield (Commit auth ri di)
      eventLoop
    (_, Just (Commit auth ri _)) -> when (curRound <= ri) $ do
      yield (RoundChange auth (roundidRound ri + 1))
      eventLoop
    (_, Just (RoundChange _ ri)) -> when ((roundidRound curRound) <= ri) $ do
      return ()
    (_, Just Timeout) -> roundChange >> eventLoop
    (_, Just (CommitFailure _)) -> roundChange >> eventLoop
