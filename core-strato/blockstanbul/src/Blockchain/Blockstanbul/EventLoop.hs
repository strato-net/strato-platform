{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE LambdaCase #-}
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
import Text.Printf

import Blockchain.Data.Address
import Blockchain.Data.BlockDB
import Blockchain.Blockstanbul.Authentication
import Blockchain.Blockstanbul.Messages
import Blockchain.Blockstanbul.Voting
import Blockchain.ExtendedECDSA
import Blockchain.Format
import Blockchain.SHA
import qualified Network.Haskoin.Crypto as HK

type StateMachineM m = (MonadState BlockstanbulContext m, MonadIO m, MonadLogger m)

data NextType = Round RoundNumber | Sequence SequenceNumber

data BlockstanbulContext = BlockstanbulContext {
  -- view describes which consensus round is under consideration.
    _view :: View
  -- Whether to really authenticate, or just to pretend to.
  , _productionAuth :: Bool
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
  , _hasCommitted :: Bool
  , _pendingRound :: Maybe RoundNumber
  -- Which peers have we received a notice for a round-change
  , _roundChanged :: M.Map Address RoundNumber
  , _voted :: M.Map Address (M.Map Address Bool)
  , _pendingvotes :: M.Map Address Bool
  -- The nodekey for this validator
  , _prvkey :: HK.PrvKey
  , _blockcount :: Int
  -- Block locking: a safety mechanism to prevent partial commits
  , _blockLock :: Maybe Block
  , _authSenders :: [Address]
}

makeLenses ''BlockstanbulContext

debugShowCtx :: StateMachineM m => m ()
debugShowCtx = do
  let debugLog :: (StateMachineM m2) => T.Text -> LensLike' (Const (m2 ())) BlockstanbulContext a -> (a -> String) -> m2 ()
      debugLog loc lns f = join . uses lns $ $logDebugS loc . T.pack . f
  debugLog "showctx/view" view format
  debugLog "showctx/proposer" proposer (printf "%x")
  debugLog "showctx/validators" validators (show . map (printf "%x" :: Address -> String))
  debugLog "showctx/prepared" prepared show
  debugLog "showctx/committed" committed show
  debugLog "showctx/hasPrepared" hasPrepared show
  debugLog "showctx/roundChanged" roundChanged show
  debugLog "showctx/mBlockNumber" proposal (show . fmap (blockDataNumber . blockBlockData))
  debugLog "showctx/mLockedBlockNo" blockLock (show . fmap (blockDataNumber . blockBlockData))

newContext :: View -> [Address] -> [Address] -> HK.PrvKey -> BlockstanbulContext
newContext v as senderlist pk =
  let prop = case as of
                 [] -> 0x0 -- TODO(tim): C? In my Haskell? It's more likely than you think.
                 (a:_) -> a
  in BlockstanbulContext
     { _view = v
     , _productionAuth = True
     , _proposal = Nothing
     , _proposer = prop
     , _validators = as
     , _prepared = M.empty
     , _committed = M.empty
     , _hasPrepared = False
     , _hasCommitted = False
     , _pendingRound = Nothing
     , _roundChanged = M.empty
     , _voted = M.empty
     , _pendingvotes = M.empty
     , _prvkey = pk
     , _blockcount = 0
     , _blockLock = Nothing
     , _authSenders = senderlist
     }

selfAddr :: (StateMachineM m) => m Address
selfAddr = uses prvkey prvKey2Address

authorize :: (StateMachineM m) => InEvent -> m Bool
authorize = \case
  IMsg (MsgAuth addr _) _ -> uses validators (addr `elem`)
  _ -> return True

isAuthorized :: (StateMachineM m) => InEvent -> m Bool
isAuthorized iev = do
  let authenticated = authenticate iev
  authorized <- authorize iev
  specificAuth <-
    case iev of
      NewBeneficiary (MsgAuth addr sign) (benf, dir) -> do
        slist <- use authSenders
        let senderverified = verifyBenfInfo (benf,dir) sign
        return $ elem addr slist && Just addr == senderverified
      IMsg (MsgAuth addr _) (Preprepare _ pp) -> do
        vali <- use validators
        let validatorMatch = vali == (getValidatorList pp)
            signatory = verifyProposerSeal pp =<< getProposerSeal pp
        return $ validatorMatch && Just addr == signatory
      IMsg (MsgAuth addr _) (Commit _ di seal) -> do
        return $ Just addr == verifyCommitmentSeal di seal
      _ -> return True -- No specific auth for any other messages
  doAuthn <- use productionAuth
  return $ if doAuthn
              then authorized && authenticated && specificAuth
              else authorized

hasSameHash :: (StateMachineM m) => SHA -> m Bool
hasSameHash di = uses proposal $ maybe False ((==di) . blockHash)

roundChange :: (StateMachineM m) => Conduit InEvent m OutEvent
roundChange = do
  nextView <- uses view (over round (+1))
  pk <- use prvkey
  pendingRound .= Just (_round nextView)
  yield =<< signMessage pk (RoundChange nextView)

nextRound :: (StateMachineM m) => NextType -> Conduit InEvent m OutEvent
nextRound nt = do
  -- TODO(tim): Create an emptyRound constant and override validators/proposer/view,
  -- rather than reset everything in the state.
  epocheck <- use blockcount
  when (epocheck `mod` 10000 == 0) $ do
      voted .= M.empty
      blockcount .= 0

   --update validators list
  val <- use validators
  vot <- use voted
  validators .= updateValidator val vot

  case nt of
    Sequence s -> view . sequence .= s
    Round r -> do
      view . round .= r
      yield $ ResetTimer r
  vals <- use validators
  thisR <- use $ view . round
  let leader = vals !! (fromIntegral thisR `mod` length vals)
  proposer .= leader
  proposal .= Nothing
  self <- selfAddr
  when (leader == self) $ do
    lock <- use blockLock
    case lock of
      Nothing -> yield MakeBlockCommand
      Just lb -> do
        pk <- use prvkey
        v <- use view
        yield =<< signMessage pk (Preprepare v lb)
  prepared .= M.empty
  committed .= M.empty
  roundChanged .= M.empty

  hasCommitted .= False
  hasPrepared .= False
  pendingRound .= Nothing

eventLoop :: (MonadIO m, MonadLogger m) => BlockstanbulContext -> ConduitM InEvent OutEvent m BlockstanbulContext
eventLoop ctx = execStateC ctx $ awaitForever $ \ev -> do
  debugShowCtx
  authz <- lift $ isAuthorized ev
  v <- use view
  when authz $ case ev of
    NewBeneficiary _ (benf,decision)  -> do
      pendingvotes %= M.insert benf decision
    NewBlock blk' -> do
      let blk = truncateExtra blk'
      ppl <- use proposal
      leader <- use proposer
      self <- selfAddr
      when (isNothing ppl && leader == self) $ do
        pk <- use prvkey
        vs <- use validators
        --extract from pending list and vote
        pending <- use pendingvotes
        editedBlk <- if null pending
              then return blk
              else do
                 let ((bnf,nonc),newPending) = M.deleteFindMin pending
                 pendingvotes .= newPending
                 return $ editBeneficiary blk bnf nonc
        let blockWithVs = addValidators vs editedBlk
        pseal <- proposerSeal blockWithVs pk
        let sealedBlk = addProposerSeal pseal blockWithVs
        mLocked <- use blockLock
        let realSealed = fromMaybe sealedBlk mLocked
        proposal .= Just realSealed
        yield =<< signMessage pk (Preprepare v realSealed)
    IMsg auth (Preprepare v' pp) -> do
      pr <- use proposer
      if (sender auth /= pr)
        then $logWarnS "blockstanbul/ppl" . T.pack $
                printf "Rejecting proposal: proposer %x is not %x" (sender auth) pr
        else do
          mBlockLock <- use blockLock
          if (isJust mBlockLock && Just pp /= mBlockLock)
            then do
              $logWarnS "blockstanbul/ppl" . T.pack $
                printf "Rejecting proposal: block does not match lock"
              $logDebugS "blockstanbul/roundchange" "lock mismatch"
              roundChange
            else
              if v /= v'
                then do
                  $logDebugS "blockstanbul/roundchange" . T.pack $
                     "view mismatch (us, sender): " ++ format (v, v')
                  $logWarnS "blockstanbul/ppl" . T.pack $
                    printf "Rejecting proposal: " ++ format v' ++ " is not " ++ format v
                  roundChange
                else do
                   blockcount += 1
                   proposal .= Just pp
                   pk <- use prvkey
                   case extractBeneficiary pp of
                     Nothing -> return()
                     Just (bnef,vot) -> do
                       -- insert the vote into map
                       val <- uses voted $M.lookup bnef
                       let unwrapVal = fromMaybe M.empty val
                       let nval = M.insert pr vot unwrapVal
                       voted %= M.insert bnef nval
                   yield =<< signMessage pk (Prepare v (blockHash pp))
    IMsg auth (Prepare v' di) -> when (v <= v') $ do
      ps <- prepared <%= M.insert (sender auth) di
      total <- uses validators length
      let sameVoteCount = M.size . M.filter (==di) $ ps
      sameHash <- hasSameHash di
      hasSent <- use hasPrepared
      when (3 * sameVoteCount > 2 * total && sameHash && not hasSent) $ do
        hasPrepared .= True
        (blockLock .=) =<< (use proposal)
        pk <- use prvkey
        seal <- commitmentSeal di pk
        yield =<< signMessage pk (Commit v di seal)
    IMsg auth (Commit v' di seal) -> when (v <= v') $ do
      cs <- committed <%= M.insert (sender auth) (di, seal)
      total <- uses validators length
      let sameVoteCount = M.size . M.filter ((==di) . fst) $ cs
      sameHash <- hasSameHash di
      -- TODO(tim): Is it necessary to check that we have prepared?
      hasSent <- use hasCommitted
      when (3 * sameVoteCount > 2 * total && sameHash && not hasSent ) $ do
        hasCommitted .= True
        ppl <- use proposal
        case ppl of
          Nothing -> error "TODO(tim): Decide how to handle this"
          Just blk -> do
            let seals = map snd . M.elems $ cs
            yield . ToCommit . addCommitmentSeals seals $ blk
    IMsg auth (RoundChange vn) -> when (_round v < _round vn) $ do
      let rn = _round vn
      rs <- roundChanged <%= M.insert (sender auth) rn
      total <- uses validators length
      sentRN <- use pendingRound
      let sameRNCount = M.size . M.filter (== rn) $ rs
      when (3 * sameRNCount > total && Just rn > sentRN) $ do
        pendingRound .= Just rn
        pk <- use prvkey
        $logDebugS "blockstanbul/roundchange" "agreed change"
        yield =<< signMessage pk (RoundChange vn)
      when (3 * sameRNCount > 2 * total) $ do
        next <- use pendingRound
        when (_sequence v < _sequence vn) $ do
          -- Assume that we have missed the commit of the locked block, because
          -- the rest of the nodes have moved on.
          blockLock .= Nothing
        case next of
          Nothing -> error "TODO(tim): a round was voted on without existing"
          Just r -> nextRound (Round r)
      return ()
    Timeout r' -> do
      case r' `compare` _round v of
        LT ->
          let msg = printf "Ignoring stale timeout for %v (now %v)" r' (_round v)
          in $logDebugS "blockstanbul" . T.pack $ msg
        EQ -> do
          $logWarnS "blockstanbul" . T.pack $ printf "Round %v timed out" r'
          $logDebugS "blockstanbul/roundchange" "timeout"
          roundChange
        GT -> error $ printf "We're in a time loop: %v was received at now=%v" r' (_round v)
    CommitResult (Left err) -> do
      $logWarnS "blockstanbul" err
      $logDebugS "blockstanbul/roundchange" "commit failure (how...)"
      blockLock .= Nothing
      roundChange
    CommitResult (Right ()) -> do
      $logDebugS "blockstanbul" "Successful block commit"
      s <- use $ view . sequence
      blockLock .= Nothing
      nextRound . Sequence $ s+1

class (Monad m) => HasBlockstanbulContext m where
  getBlockstanbulContext :: m (Maybe BlockstanbulContext)
  putBlockstanbulContext :: BlockstanbulContext -> m ()

loopback :: OutEvent -> Maybe InEvent
loopback (OMsg a m) = Just $ IMsg a m
loopback _ = Nothing

sendMessages :: (MonadIO m, MonadLogger m, HasBlockstanbulContext m) => [InEvent] -> m [OutEvent]
sendMessages wms = do
  -- It may be somewhat confusing, but there are actually 2 StateTs with BlockstanbulContext
  -- Every run of the conduit has one, but the outer monad preserves the context between runs.
  mCtx <- getBlockstanbulContext
  case mCtx of
    Nothing -> do
      $logErrorS "blockstanbul" "cannot send messages without a BlockstanbulContext"
      return []
    Just ctx -> do
      let base = yieldMany wms
              .| iterMC ($logDebugS "blockstanbul/InEvent" . T.pack . show)
              .| eventLoop ctx
              `fuseUpstream` iterMC ($logDebugS "blockstanbul/OutEvent" . T.pack . show)
      (ctx', evs) <- runConduit $ fuseBoth base sinkList
      putBlockstanbulContext ctx'
      return evs

sendAllMessages :: (MonadIO m, MonadLogger m, HasBlockstanbulContext m) => [InEvent] -> m [OutEvent]
sendAllMessages wms = do
  out <- sendMessages wms
  $logDebugS "sendAllMessages" . T.pack . show $ out
  case catMaybes . map loopback $ out of
             [] -> return out
             wms' -> (out ++) <$> sendAllMessages wms'

currentView :: (HasBlockstanbulContext m) => m View
currentView = maybe (View (-1) (-1)) _view <$> getBlockstanbulContext

blockstanbulRunning :: HasBlockstanbulContext m => m Bool
blockstanbulRunning = isJust <$> getBlockstanbulContext
