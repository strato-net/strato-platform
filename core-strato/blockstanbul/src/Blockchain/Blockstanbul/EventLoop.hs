{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TemplateHaskell #-}
module Blockchain.Blockstanbul.EventLoop where

import Conduit
import Control.Lens
import Control.Monad
import Control.Monad.State.Class

import qualified Data.Map as M

import Blockchain.Data.Address
import Blockchain.Data.BlockDB
import Blockchain.Blockstanbul.Messages
import Blockchain.SHA

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
  -- Validators who have sent us a prepare for this round
  , _prepared :: M.Map Address SHA
  -- Validators who have sent us a commitment seal for this round
  , _committed :: M.Map Address (SHA, Seal)
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

hasSameHash :: (StateMachineM m) => SHA -> m Bool
hasSameHash di = uses proposal $ maybe False ((==di) . blockHash)

-- TODO(tim): Define an exit type from the conduit for sending blocks to the EVM
-- TODO(tim): what to do if the block hasn't arrived yet?
commit :: (StateMachineM m) => Maybe Block -> Conduit BlockstanbulEvent m BlockstanbulEvent
commit _ = return ()

eventLoop :: (StateMachineM m) => Conduit BlockstanbulEvent m BlockstanbulEvent
eventLoop = awaitForever $ \wm' -> do
  authz <- lift $ isAuthorized wm'
  curRound <- use roundId
  when authz $ case wm' of
    Preprepare auth ri pp -> do
      pr <- use proposer
      when (Just (sender (auth)) == pr) $ do
        proposal .= Just pp
        if curRound == ri
          -- TODO(tim): use own auth
          then yield (Prepare auth ri (blockHash pp))
          else roundChange
    Prepare auth ri di -> when (curRound <= ri) $ do
      ps <- prepared <%= M.insert (sender auth) di
      total <- uses validators length
      let sameVoteCount = M.size . M.filter (==di) $ ps
      sameHash <- hasSameHash di
      when (3 * sameVoteCount >= 2 * total && sameHash) $ do
        -- TODO(tim): use own auth
        yield (Commit auth ri di ())
    Commit auth ri di seal -> when (curRound <= ri) $ do
      cs <- committed <%= M.insert (sender auth) (di, seal)
      total <- uses validators length
      let sameVoteCount = M.size . M.filter ((==di) . fst) $ cs
      sameHash <- hasSameHash di
      -- TODO(tim): Is it necessary to check that we have prepared?
      when (3 * sameVoteCount >= 2 * total && sameHash) $ do
        join $ uses proposal commit
      -- TODO(tim): use own auth
      yield (RoundChange auth (roundidRound ri + 1))
    RoundChange _ ri -> when ((roundidRound curRound) <= ri) $ do
      return ()
    Timeout -> roundChange
    CommitFailure _ -> roundChange
