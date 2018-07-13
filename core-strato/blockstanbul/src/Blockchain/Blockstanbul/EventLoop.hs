{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE OverloadedStrings #-}
module Blockchain.Blockstanbul.EventLoop where

import Conduit
import Control.Lens hiding (view)
import Control.Monad hiding (sequence)
import Control.Monad.Logger
import Control.Monad.State.Class
import qualified Data.Map as M
import Data.Maybe
import qualified Data.Text as T
import Prelude hiding (round, sequence)

import Blockchain.Data.Address
import Blockchain.Data.BlockDB
import Blockchain.Blockstanbul.Authentication
import Blockchain.Blockstanbul.Messages
import Blockchain.ExtendedECDSA
import Blockchain.SHA
import qualified Network.Haskoin.Crypto as HK

type StateMachineM m = (MonadState BlockstanbulContext m, MonadIO m)

data NextType = Round RoundNumber | Sequence SequenceNumber

data BlockstanbulContext = BlockstanbulContext {
  -- view describes which consensus round is under consideration.
    _view :: View
  -- authenticator authenticates wire messages are coming from the right sender
  , _authenticator :: WireMessage -> Bool
  -- The block proposed for this round
  , _proposal :: Maybe Block
  -- The designated participant to suggest a block for this round
  , _proposer :: Address
  -- The total group of participants
  , _validators :: [Address]
  -- Validators who have sent us a prepare for this round
  , _prepared :: M.Map Address SHA
  -- Validators who have sent us a commitment seal for this round
  , _committed :: M.Map Address (SHA, ExtendedSignature)
  -- We've already sent out a commit message to indicate a transition
  -- to prepared
  , _hasPrepared :: Bool
  , _pendingRound :: Maybe RoundNumber
  -- Which peers have we received a notice for a round-change
  , _roundChanged :: M.Map Address RoundNumber

  -- The nodekey for this validator
  , _prvkey :: HK.PrvKey
}
makeLenses ''BlockstanbulContext

newContext :: View -> [Address] -> HK.PrvKey -> BlockstanbulContext
newContext v as pk =
  let prop = case as of
                 [] -> 0x0 -- TODO(tim): C? In my Haskell? It's more likely than you think.
                 (a:_) -> a
  in BlockstanbulContext
     { _view = v
     , _authenticator = const True
     , _proposal = Nothing
     , _proposer = prop
     , _validators = as
     , _prepared = M.empty
     , _committed = M.empty
     , _hasPrepared = False
     , _pendingRound = Nothing
     , _roundChanged = M.empty
     , _prvkey = pk
     }

selfAddr :: (StateMachineM m) => m Address
selfAddr = uses prvkey prvKey2Address

isAuthorized :: (StateMachineM m) => InEvent -> m Bool
isAuthorized (IMsg wm) = do
  let MsgAuth addr _ = getAuth wm
  authn <- use authenticator
  if not (authn wm)
    then return False
    else do
      authorized <- use validators
      return $ addr `elem` authorized
-- Internally generated events are trusted implicitly
isAuthorized _ = return True

hasSameHash :: (StateMachineM m) => SHA -> m Bool
hasSameHash di = uses proposal $ maybe False ((==di) . blockHash)

roundChange :: (StateMachineM m) => Conduit InEvent m OutEvent
roundChange = do
  nextView <- uses view (over round (+1))
  pk <- use prvkey
  out <- signMessage pk $ RoundChange (error "TODO(tim): refactor types") nextView
  yield . OMsg $ out

nextRound :: (StateMachineM m) => NextType -> Conduit InEvent m OutEvent
nextRound nt = do
  case nt of
    Sequence s -> view . sequence .= s
    Round r -> view . round .= r
  vals <- use validators
  thisR <- use $ view . round
  let nextP = vals !! (fromIntegral thisR `mod` length vals)
  proposer .= nextP

  prepared .= M.empty
  committed .= M.empty
  roundChanged .= M.empty

  hasPrepared .= False
  pendingRound .= Nothing

loopback :: OutEvent -> Maybe InEvent
loopback (OMsg x) = Just $ IMsg x
loopback _ = Nothing

eventLoop :: (MonadIO m, MonadLogger m) => BlockstanbulContext -> ConduitM InEvent OutEvent m BlockstanbulContext
eventLoop ctx = execStateC ctx $ awaitForever $ \ev -> do
  $logDebugS "blockstanbul" . T.pack $ "event: " ++ show ev
  authz <- lift $ isAuthorized ev
  v <- use view
  when authz $ case ev of
    IMsg (Preprepare auth v' pp) -> do
      pr <- use proposer
      $logDebugS "blockstanbul" . T.pack $ "received preprepare: " ++ show pp
      when (sender auth == pr) $ do
        $logDebugS "blockstanbul" "confirmed from the proposer"
        if v == v'
          then do
            proposal .= Just pp
            pk <- use prvkey
            out <- signMessage pk $ Prepare (error "TODO(tim): refactor message types") v (blockHash pp)
            yield . OMsg $ out
          else roundChange
    IMsg (Prepare auth v' di) -> when (v <= v') $ do
      ps <- prepared <%= M.insert (sender auth) di
      total <- uses validators length
      let sameVoteCount = M.size . M.filter (==di) $ ps
      sameHash <- hasSameHash di
      hasSent <- use hasPrepared
      when (3 * sameVoteCount > 2 * total && sameHash && not hasSent) $ do
        hasPrepared .= True
        pk <- use prvkey
        seal <- commitmentSeal di pk
        out <- signMessage pk $ Commit (error "TODO(tim): refactor message types")
                                       v
                                       di
                                       seal
        yield . OMsg $ out
    IMsg (Commit auth v' di seal) -> when (v <= v') $ do
      cs <- committed <%= M.insert (sender auth) (di, seal)
      total <- uses validators length
      let sameVoteCount = M.size . M.filter ((==di) . fst) $ cs
      sameHash <- hasSameHash di
      -- TODO(tim): Is it necessary to check that we have prepared?
      when (3 * sameVoteCount > 2 * total && sameHash) $ do
        ppl <- use proposal
        case ppl of
          Nothing -> error "TODO(tim): Decide how to handle this"
          Just blk -> yield . ReadyBlock $ blk
    IMsg (RoundChange auth vn) -> when (_round v <= _round vn) $ do
      let rn = _round vn
      rs <- roundChanged <%= M.insert (sender auth) rn
      total <- uses validators length
      sentRN <- use pendingRound
      let sameRNCount = M.size . M.filter (== rn) $ rs
      when (3 * sameRNCount > total && Just rn > sentRN) $ do
        pendingRound .= Just rn
        pk <- use prvkey
        out <- signMessage pk $ RoundChange (error "TODO(tim): refactor types") vn
        yield . OMsg $ out
      when (3 * sameRNCount > 2 * total) $ do
        next <- use pendingRound
        case next of
          Nothing -> error "a round was voted on without existing"
          Just r -> nextRound (Round r)
      return ()
    Timeout -> do
      $logWarnS "blockstanbul" "Round timed out"
      roundChange
    CommitResult (Left err) -> do
      $logWarnS "blockstanbul" err
      roundChange
    CommitResult (Right ()) -> do
      s <- use $ view . sequence
      nextRound . Sequence $ s+1
    NewBlock blk -> do
      ppl <- use proposal
      leader <- use proposer
      self <- selfAddr
      when (isNothing ppl && leader == self) $ do
        proposal .= Just blk
        pk <- use prvkey
        out <- signMessage pk $ Preprepare (error "TODO(tim): refactor types") v blk
        yield . OMsg $ out

class (Monad m) => HasBlockstanbulContext m where
  getBlockstanbulContext :: m BlockstanbulContext
  putBlockstanbulContext :: BlockstanbulContext -> m ()

sendMessages :: (MonadIO m, MonadLogger m, HasBlockstanbulContext m) => [InEvent] -> m [OutEvent]
sendMessages wms = do
  -- It may be somewhat confusing, but there are actually 2 StateTs with BlockstanbulContext
  -- Every run of the conduit has one, but the outer monad preserves the context between runs.
  ctx <- getBlockstanbulContext
  let base = yieldMany wms .| eventLoop ctx
  (ctx', evs) <- runConduit $ fuseBoth base sinkList
  putBlockstanbulContext ctx'
  return evs

sendAllMessages :: (MonadIO m, MonadLogger m, HasBlockstanbulContext m) => [InEvent] -> m ()
sendAllMessages wms = do
  out <- sendMessages wms
  $logInfoS "sendAllMessages" . T.pack . show $ out
  case catMaybes . map loopback $ out of
    [] -> return ()
    wms' -> sendAllMessages wms'
