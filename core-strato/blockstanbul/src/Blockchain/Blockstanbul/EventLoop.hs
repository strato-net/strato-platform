{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TemplateHaskell #-}
module Blockchain.Blockstanbul.EventLoop where

import Conduit
import Control.Lens hiding (view)
import Control.Monad
import Control.Monad.State.Class

import qualified Data.Map as M

import Blockchain.Data.Address
import Blockchain.Data.BlockDB
import Blockchain.Blockstanbul.Messages
import Blockchain.SHA

type StateMachineM m = (MonadIO m, MonadState BlockstanbulContext m)

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
  -- We've already committed this block, no need to do it again.
  , _hasCommitted :: Bool
  , _pendingView :: Maybe View
  -- Which peers have we received a notice for a round-change
  , _roundChanged :: M.Map Address View
  -- Have we broadcast our own round-change?
  , _hasRoundChanged :: Bool
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
  View r s <- use view
  yield . RoundChange (error "TODO(tim): supply a private key to StateMachineM") $ View (r+1) s

hasSameHash :: (StateMachineM m) => SHA -> m Bool
hasSameHash di = uses proposal $ maybe False ((==di) . blockHash)

-- TODO(tim): Define an exit type from the conduit for sending blocks to the EVM
-- TODO(tim): what to do if the block hasn't arrived yet?
commit :: (StateMachineM m) => Maybe Block -> Conduit BlockstanbulEvent m BlockstanbulEvent
commit _ = return ()

nextRound :: (StateMachineM m) => Maybe View -> Conduit BlockstanbulEvent m BlockstanbulEvent
nextRound Nothing = error "next round without a pending view"
nextRound (Just v) = do
  view .= v
  prepared .= M.empty
  hasPrepared .= False
  committed .= M.empty
  hasCommitted .= False
  hasRoundChanged .= False
  pendingView .= Nothing
  vals <- use validators
  proposer .= vals !! (fromIntegral (viewRound v) `mod` length vals)

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
      hasSent <- use hasCommitted
      when (3 * sameVoteCount > 2 * total && sameHash && not hasSent) $ do
        hasCommitted .= True
        join $ uses proposal commit
    RoundChange auth v' -> when (v <= v') $ do
      rs <- roundChanged <%= M.insert (sender auth) v'
      total <- uses validators length
      hasSent <- use hasRoundChanged
      when (3 * M.size rs > total && not hasSent) $ do
        hasRoundChanged .= True
        -- TODO(tim): use own auth
        yield (RoundChange auth v')
      when (3 * M.size rs > 2 * total) $ do
        join $ uses pendingView nextRound
      return ()
    Timeout -> roundChange
    CommitFailure _ -> roundChange
