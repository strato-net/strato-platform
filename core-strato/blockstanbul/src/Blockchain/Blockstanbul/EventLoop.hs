{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TemplateHaskell #-}
module Blockchain.Blockstanbul.EventLoop where

import Conduit
import Control.Lens hiding (view)
import Control.Monad hiding (sequence)
import Control.Monad.State.Class
import qualified Data.Map as M
import Prelude hiding (round, sequence)

import Blockchain.Data.Address
import Blockchain.Data.BlockDB
import Blockchain.Blockstanbul.Messages
import Blockchain.SHA

type StateMachineM m = (MonadIO m, MonadState BlockstanbulContext m)

data NextType = Round RoundNumber | Sequence SequenceNumber

data BlockstanbulContext = BlockstanbulContext {
  -- view describes which consensus round is under consideration.
    _view :: View
  -- authenticator authenticates wire messages are coming from the right sender
  , _authenticator :: BlockstanbulEvent -> Bool
  -- The block proposed for this round
  , _proposal :: Maybe Block
  -- The designated participant to suggest a block for this round
  , _proposer :: Address
  -- The total group of participants
  , _validators :: [Address]
  -- Validators who have sent us a prepare for this round
  , _prepared :: M.Map Address SHA
  -- Validators who have sent us a commitment seal for this round
  , _committed :: M.Map Address (SHA, Seal)
  -- We've already sent out a commit message to indicate a transition
  -- to prepared
  , _hasPrepared :: Bool
  , _pendingRound :: Maybe RoundNumber
  -- Which peers have we received a notice for a round-change
  , _roundChanged :: M.Map Address RoundNumber
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

hasSameHash :: (StateMachineM m) => SHA -> m Bool
hasSameHash di = uses proposal $ maybe False ((==di) . blockHash)

roundChange :: (StateMachineM m) => Conduit BlockstanbulEvent m BlockstanbulEvent
roundChange = do
  r <- use (view . round)
  yield . RoundChange (error "TODO(tim): supply a private key to StateMachineM") $ r+1

-- TODO(tim): Define an exit type from the conduit for sending blocks to the EVM
-- TODO(tim): what to do if the block hasn't arrived yet?
commit :: (StateMachineM m) => Maybe Block -> Conduit BlockstanbulEvent m BlockstanbulEvent
commit _ = do
  s <- use $ view . sequence
  nextRound . Sequence $ s+1

nextRound :: (StateMachineM m) => NextType -> Conduit BlockstanbulEvent m BlockstanbulEvent
nextRound nt = do
  case nt of
    Sequence s -> view . sequence .= s
    Round r -> view . round .= r
  vals <- use validators
  thisR <- use $ view . round
  proposer .= vals !! (fromIntegral thisR  `mod` length vals)

  prepared .= M.empty
  committed .= M.empty
  roundChanged .= M.empty

  hasPrepared .= False
  pendingRound .= Nothing

eventLoop :: (StateMachineM m) => Conduit BlockstanbulEvent m BlockstanbulEvent
eventLoop = awaitForever $ \ev -> do
  authz <- lift $ isAuthorized ev
  v <- use view
  when authz $ case ev of
    Preprepare auth v' pp -> do
      pr <- use proposer
      when (sender auth == pr) $ do
        proposal .= Just pp
        if v == v'
          -- TODO(tim): use own auth
          then yield (Prepare auth v (blockHash pp))
          else roundChange
    Prepare auth v' di -> when (v <= v') $ do
      ps <- prepared <%= M.insert (sender auth) di
      total <- uses validators length
      let sameVoteCount = M.size . M.filter (==di) $ ps
      sameHash <- hasSameHash di
      hasSent <- use hasPrepared
      when (3 * sameVoteCount > 2 * total && sameHash && not hasSent) $ do
        hasPrepared .= True
        -- TODO(tim): use own auth
        yield (Commit auth v di ())
    Commit auth v' di seal -> when (v <= v') $ do
      cs <- committed <%= M.insert (sender auth) (di, seal)
      total <- uses validators length
      let sameVoteCount = M.size . M.filter ((==di) . fst) $ cs
      sameHash <- hasSameHash di
      -- TODO(tim): Is it necessary to check that we have prepared?
      when (3 * sameVoteCount > 2 * total && sameHash) $ do
        join $ uses proposal commit
    RoundChange auth rn -> when (_round v <= rn) $ do
      rs <- roundChanged <%= M.insert (sender auth) rn
      total <- uses validators length
      sentRN <- use pendingRound
      let sameRNCount = M.size . M.filter (== rn) $ rs
      when (3 * sameRNCount > total && Just rn > sentRN) $ do
        pendingRound .= Just rn
        -- TODO(tim): use own auth
        yield (RoundChange auth rn)
      when (3 * sameRNCount > 2 * total) $ do
        next <- use pendingRound
        case next of
          Nothing -> error "a round was voted on without existing"
          Just r -> nextRound (Round r)
      return ()
    Timeout -> roundChange
    CommitFailure _ -> roundChange
