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
import Blockchain.Blockstanbul.Voting
import Blockchain.ExtendedECDSA
import Blockchain.SHA
import qualified Network.Haskoin.Crypto as HK

type StateMachineM m = (MonadState BlockstanbulContext m, MonadIO m, MonadLogger m)

data NextType = Round RoundNumber | Sequence SequenceNumber

data BlockstanbulContext = BlockstanbulContext {
  -- view describes which consensus round is under consideration.
    _view :: View
  -- authenticator authenticates wire messages are coming from the right sender
  , _authenticator :: InEvent -> Bool
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
     , _hasCommitted = False
     , _pendingRound = Nothing
     , _roundChanged = M.empty
     , _voted = M.empty
     , _pendingvotes = M.empty
     , _prvkey = pk
     , _blockcount = 0
     }

selfAddr :: (StateMachineM m) => m Address
selfAddr = uses prvkey prvKey2Address

isAuthorized :: (StateMachineM m) => InEvent -> m Bool
isAuthorized iev = do
  authn <- use authenticator
  if not (authn iev)
    then return False
    else case iev of
            IMsg (MsgAuth addr _) _ -> uses validators (addr `elem`)
            _ -> return True -- No sender for timeouts!

hasSameHash :: (StateMachineM m) => SHA -> m Bool
hasSameHash di = uses proposal $ maybe False ((==di) . blockHash)

roundChange :: (StateMachineM m) => Conduit InEvent m OutEvent
roundChange = do
  nextView <- uses view (over round (+1))
  pk <- use prvkey
  yield =<< signMessage pk (RoundChange nextView)

nextRound :: (StateMachineM m) => NextType -> Conduit InEvent m OutEvent
nextRound nt = do
  -- TODO(tim): Create an emptyRound constant and override validators/proposer/view,
  -- rather than reset everything in the state.
  epocheck <- use blockcount
  when (epocheck `mod` 10000 == 0) $ do
      voted .= M.empty
      blockcount .= 0
  case nt of
    Sequence s -> view . sequence .= s
    Round r -> view . round .= r
  vals <- use validators
  thisR <- use $ view . round
  let leader = vals !! (fromIntegral thisR `mod` length vals)
  proposer .= leader
  proposal .= Nothing
  self <- selfAddr
  when (leader == self) $ do
    yield MakeBlockCommand
  prepared .= M.empty
  committed .= M.empty
  roundChanged .= M.empty

  hasCommitted .= False
  hasPrepared .= False
  pendingRound .= Nothing 

  --update validators list
  val <- use validators
  vot <- use voted
  let finds = updatevalidator val vot
  validators .= finds
  
eventLoop :: (MonadIO m, MonadLogger m) => BlockstanbulContext -> ConduitM InEvent OutEvent m BlockstanbulContext
eventLoop ctx = execStateC ctx $ awaitForever $ \ev -> do
  authz <- lift $ isAuthorized ev
  v <- use view
  when authz $ case ev of
    NewBeneficiary benf decision  -> do
      pvotes <- use pendingvotes
      pendingvotes .= M.insert benf decision pvotes
      return ()
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
                 let (bnf,nonc) = M.findMin pending
                 pendingvotes .= M.deleteMin pending
                 return $ editBeneficiary blk bnf nonc
        let blockWithVs = addValidators vs editedBlk
        pseal <- proposerSeal blockWithVs pk
        let sealedBlk = addProposerSeal pseal blockWithVs
        proposal .= Just sealedBlk
        yield =<< signMessage pk (Preprepare v sealedBlk)
    IMsg auth (Preprepare v' pp) -> do
      pr <- use proposer
      when (sender auth == pr) $ do
        if v == v'
          then do
            --bc <- use blockcount
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
          else roundChange
    IMsg auth (Prepare v' di) -> when (v <= v') $ do
      ps <- prepared <%= M.insert (sender auth) di
      total <- uses validators length
      let sameVoteCount = M.size . M.filter (==di) $ ps
      sameHash <- hasSameHash di
      hasSent <- use hasPrepared
      when (3 * sameVoteCount > 2 * total && sameHash && not hasSent) $ do
        hasPrepared .= True
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
        yield =<< signMessage pk (RoundChange vn)
      when (3 * sameRNCount > 2 * total) $ do
        next <- use pendingRound
        case next of
          Nothing -> error "TODO(tim): a round was voted on without existing"
          Just r -> nextRound (Round r)
      return ()
    Timeout -> do
      $logWarnS "blockstanbul" "Round timed out"
      roundChange
    CommitResult (Left err) -> do
      $logWarnS "blockstanbul" err
      roundChange
    CommitResult (Right ()) -> do
      $logDebugS "blockstanbul" "Successful block commit"
      s <- use $ view . sequence
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
