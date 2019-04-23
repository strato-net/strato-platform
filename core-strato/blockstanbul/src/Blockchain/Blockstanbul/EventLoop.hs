{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE LambdaCase #-}
module Blockchain.Blockstanbul.EventLoop where

import Conduit
import Control.Lens hiding (view)
import Control.Monad hiding (sequence)
import Blockchain.Output
import Control.Monad.State.Class
import qualified Data.Map.Strict as M
import Data.Maybe
import Data.Monoid ((<>))
import qualified Data.Set as S
import qualified Data.Text as T
import Prelude hiding (round, sequence)
import Prometheus
import System.Exit
import Text.Printf

import Blockapps.Crossmon

import Blockchain.Data.Address
import Blockchain.Data.Block
import Blockchain.Data.BlockDB
import Blockchain.Blockstanbul.Authentication
import Blockchain.Blockstanbul.Messages
import Blockchain.Blockstanbul.Metrics
import Blockchain.Blockstanbul.Voting
import Blockchain.ExtendedECDSA
import Blockchain.Strato.Model.SHA
import qualified Network.Haskoin.Crypto as HK
import Text.Format

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
  , _validators :: S.Set Address
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
  , _lockSender :: Maybe Address
  , _authSenders :: M.Map Address Int
  -- TODO(tim): Initialize _lastParent with the genesis block and
  -- make it required
  , _lastParent :: Maybe SHA
}

makeLenses ''BlockstanbulContext

debugShowCtx :: StateMachineM m => m ()
debugShowCtx = do
  let debugLog :: (StateMachineM m2) => T.Text -> LensLike' (Const (m2 ())) BlockstanbulContext a -> (a -> String) -> m2 ()
      infoLog loc lns f = join . uses lns $ $logInfoS loc . T.pack . f
      debugLog loc lns f = join . uses lns $ $logDebugS loc . T.pack . f
  infoLog "showctx/view" view format
  infoLog "showctx/proposer" proposer (printf "%x")
  infoLog "showctx/validators" validators (show . map (printf "%x" :: Address -> String) . S.toList)
  infoLog "showctx/mBlockNumber" proposal (show . fmap (blockDataNumber . blockBlockData))
  infoLog "showctx/mLockedBlockNo" blockLock (show . fmap (blockDataNumber . blockBlockData))
  infoLog "showctx/mLockedSender" lockSender (show . fmap format)
  debugLog "showctx/prepared" prepared show
  debugLog "showctx/committed" committed show
  debugLog "showctx/hasPrepared" hasPrepared show
  debugLog "showctx/roundChanged" roundChanged show
  debugLog "showctx/admins" authSenders show

newContext :: View -> [Address] -> [Address] -> HK.PrvKey -> BlockstanbulContext
newContext v as senderlist pk =
  let valSet = S.fromList as
      prop = fromMaybe 0x0 . S.lookupMin $ valSet
  in BlockstanbulContext
     { _view = v
     , _productionAuth = True
     , _proposal = Nothing
     , _proposer = prop
     , _validators = valSet
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
     , _lockSender = Nothing
     , _authSenders = generateNonceMap senderlist
     , _lastParent = Nothing
     }

selfAddr :: (StateMachineM m) => m Address
selfAddr = uses prvkey prvKey2Address

poolSize :: (StateMachineM m) => m Int
poolSize = uses validators S.size

clearLock :: (StateMachineM m) => m ()
clearLock = do
  blockLock .= Nothing
  lockSender .= Nothing

setLock :: StateMachineM m => m ()
setLock = do
  (blockLock .=) =<< use proposal
  (lockSender .=) =<< uses proposer Just

authorize :: (StateMachineM m) => InEvent -> m Bool
authorize = \case
  IMsg (MsgAuth addr _) _ -> do
    ret <- uses validators (addr `S.member`)
    unless ret $
      $logWarnS "blockstanbul/auth" . T.pack $ "Rejecting message; sender not a validator: " ++ show addr
    return ret
  _ -> return True

isAuthorized :: (StateMachineM m) => InEvent -> m Bool
isAuthorized iev = do
  doAuthn <- use productionAuth
  let authenticated = authenticate iev
      warn = when doAuthn . $logWarnS "blockstanbul/auth" . T.pack
  unless authenticated $
    warn $ "Rejecting inevent; message failed authentication: " ++ show iev
  authorized <- authorize iev
  specificAuth <-
    case iev of
      NewBeneficiary (MsgAuth addr sign) (benf, dir, nonc) -> do
        -- Check nonce for replay attack
        slist <- use authSenders
        let ifAuthMember = M.member addr slist
            nonceAuth = Just nonc > M.lookup addr slist
            signAuth = Just addr == verifyBenfInfo (benf,dir,nonc) sign
        unless  ifAuthMember $
          warn $ "Rejecting NewBeneficiary; Sender is not approved " ++ show addr
              ++ " is not a authorized sender" ++ show slist
        unless nonceAuth $
          warn $ "Rejecting NewBeneficiary; Nonce is incorrect " ++ show nonc
        unless signAuth $
          warn $ "Rejecting NewBeneficiary; bad seal, address: " ++ show addr ++ " Seal: "
              ++ show sign ++ " info: " ++ show (benf, dir, nonc) ++ " address decoded: "
              ++ show (fromJust (verifyBenfInfo (benf,dir,nonc) sign))
        return $ ifAuthMember && nonceAuth && signAuth
      -- TODO(tim): RoundChange a Preprepare correctly signed by the proposer,
      -- but with incorrect extraData.
      IMsg _ (Preprepare _ pp) -> do
        vals <- use validators
        let payloadVals = S.fromList (getValidatorList pp)
            validatorsMatch = vals == payloadVals
            signatory = verifyProposerSeal pp =<< getProposerSeal pp
            signerExists = signatory `S.member` S.map Just vals
        unless signerExists $
          warn $ "Rejecting Preprepare; signer " ++ show (format <$> signatory)
              ++ " is not a known validator"
        unless validatorsMatch $
          warn $ "Rejecting Preprepare; payload validators "
              ++ show (S.map format payloadVals) ++ " are not expected validators "
              ++ show (S.map format vals)
        return $ signerExists && validatorsMatch
      IMsg (MsgAuth addr _) (Commit _ di seal) -> do
        let ret = Just addr == verifyCommitmentSeal di seal
        unless ret . warn $ "Rejecting Commit; bad seal"
        return ret
      _ -> return True -- No specific auth for any other messages
  return $ if doAuthn
              then authorized && authenticated && specificAuth
              else authorized

assertChainConsistency :: HK.Word256 -> Maybe SHA -> Block -> Either T.Text ()
assertChainConsistency seqNo wantParent blk = do
  let blkData = blockBlockData blk
      blkNo = fromIntegral . blockDataNumber $ blkData
      gotParent = blockDataParentHash blkData
  unless (seqNo + 1 == blkNo) .
    Left . T.pack $ printf "Rejecting block; block #%d is not required #%d" blkNo (seqNo +1)
  when (isJust wantParent && wantParent /= Just gotParent) .
    Left . T.pack $ "Rejecting block; parent hash " ++ format gotParent ++ " is not required " ++
                    format (fromMaybe (error "assertChainConsistency") wantParent)
  Right ()

generateNonceMap :: [Address] -> M.Map Address Int
generateNonceMap = M.fromList . flip zip (repeat 0)

hasSameHash :: (StateMachineM m) => SHA -> m Bool
hasSameHash di = uses proposal $ maybe False ((==di) . blockHash)

roundChange :: (StateMachineM m) => ConduitM InEvent OutEvent m ()
roundChange = do
  nextView <- uses view (over round (+1))
  pk <- use prvkey
  pendingRound .= Just (_round nextView)
  yield =<< signMessage pk (RoundChange nextView)

nextRound :: (StateMachineM m) => NextType -> ConduitM InEvent OutEvent m ()
nextRound nt = do
  -- TODO(tim): Create an emptyRound constant and override validators/proposer/view,
  -- rather than reset everything in the state.
  epocheck <- use blockcount
  when (epocheck `mod` 10000 == 0) $ do
      voted .= M.empty
      blockcount .= 0

   --update validators list
  val <- uses validators S.toList
  vot <- use voted
  validators .= S.fromList (updateValidator val vot)
  $logInfoS "blockstanbul/voting" . T.pack $
                 "nextRound: voted map" ++ show vot
  valNew <- use validators
  $logInfoS "blockstanbul/voting" . T.pack $
                 "nextRound: validators updated" ++ show valNew
  case nt of
    Sequence s -> view . sequence .= s
    Round r -> do
      view . round .= r
      yield $ ResetTimer r
  use view >>= recordView
  vals <- use validators
  thisR <- use $ view . round
  when (S.null vals) . liftIO $
    die "All participants voted out, consensus is stuck."
  let leader = (fromIntegral thisR `mod` S.size vals) `S.elemAt` vals
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
    NewBeneficiary (MsgAuth addr _) (benf, dir, nonc)  -> do
      pendingvotes %= M.insert benf dir
      authSenders %= M.insert addr nonc
      self <- selfAddr
      yield $ PendingVote benf dir self
    PreviousBlock blk -> do
      realValidators <- use validators
      seqNo <- use $ view . sequence
      let eNextSeqNo = replayHistoricBlock realValidators seqNo blk
          blockNo = blockDataNumber . blockBlockData $ blk
      recordMaxBlockNumber "pbft_previousblock" blockNo
      case eNextSeqNo of
        Left err -> $logWarnS "blockstanbul" . T.pack
                    . printf "Rejecting historical block #%d: %s" blockNo $ err
        Right (_, props) -> do
          $logInfoS "blockstanbul" . T.pack . printf "Accepting historical block #%d" $ blockNo
          editVoted blk props
          yield . ToCommit $ blk
    UnannouncedBlock blk' -> do
      let blk = truncateExtra blk'
      ppl <- use proposal
      leader <- use proposer
      self <- selfAddr
      when (isNothing ppl && leader == self) $ do
        pk <- use prvkey
        vs <- use validators
        --extract from pending list and vote
        pending <- use pendingvotes
        $logInfoS "blockstanbul/voting" . T.pack $
                 "pending votes: " ++ show pending
        editedBlk <- if null pending
              then do
                $logDebugS "blockstanbul/voting" "No votes pending"
                return blk
              else do
                 let ((bnf,nonc),newPending) = M.deleteFindMin pending
                 pendingvotes .= newPending
                 let nb = editBeneficiary blk bnf nonc
                 $logInfoS "blockstanbul/voting" . T.pack
                    . printf "Casting vote for %s" . show . blockDataCoinbase $ blockBlockData nb
                 return nb
        pending' <- use pendingvotes
        $logInfoS "blockstanbul/voting" . T.pack $
           "pending votes after editBeneficiary" ++ show pending'
        let blockWithVs = addValidators vs editedBlk
        pseal <- proposerSeal blockWithVs pk
        let sealedBlk = addProposerSeal pseal blockWithVs
        mLocked <- use blockLock
        let realSealed = fromMaybe sealedBlk mLocked
        wantParent <- use lastParent
        seqNo <- use (view . sequence)
        case assertChainConsistency seqNo wantParent realSealed of
          Left err -> do
            $logWarnS "blockstanbul" $ "Retrying to build block: " <> err
            when (isJust mLocked) $ do
              -- TODO(tim): It may make sense to crash here, but it's also possible that
              -- peers will be able to commit the lock and historic replay of it
              -- could absolve us.
              $logErrorS "blockstanbul" "Lock has wrong block number; cannot commit"
            yield MakeBlockCommand
          Right () -> do
            proposal .= Just realSealed
            yield =<< signMessage pk (Preprepare v realSealed)
    IMsg auth (Preprepare v' pp) -> do
      pr <- use proposer
      mBlockLock <- use blockLock
      case () of
        () | sender auth /= pr ->
              $logWarnS "blockstanbul/ppl" . T.pack $
                printf "Rejecting proposal: proposer %x is not %x" (sender auth) pr
           | v /= v' -> do
              $logInfoS "blockstanbul/roundchange" . T.pack $
                 "view mismatch (us, sender): " ++ format (v, v')
              $logWarnS "blockstanbul/ppl" . T.pack $
                printf "Rejecting proposal: " ++ format v' ++ " is not " ++ format v
              let intSeq = fromIntegral . _sequence
              when (_sequence v < _sequence v') $
                yield $ GapFound (intSeq v) (intSeq v') (sender auth)
              when (_sequence v > _sequence v') $
                yield $ LeadFound (intSeq v) (intSeq v') (sender auth)
              roundChange
           | isJust mBlockLock && Just pp /= mBlockLock -> do
              $logWarnS "blockstanbul/ppl" "Rejecting proposal: block does not match lock"
              $logInfoS "blockstanbul/roundchange" "lock mismatch"
              roundChange
           | otherwise -> do
              wantParent <- use lastParent
              case assertChainConsistency (_sequence v) wantParent pp of
                Left err -> do
                  $logWarnS "blockstanbul/ppl" $ "Rejecting proposal: " <> err
                  $logInfoS "blockstanbul/roundchange" "chain inconsistency"
                  roundChange
                Right () -> do
                  blockcount += 1
                  proposal .= Just pp
                  pk <- use prvkey
                  editVoted pp pr
                  yield =<< signMessage pk (Prepare v (blockHash pp))
    IMsg auth (Prepare v' di) -> when (v <= v') $ do
      ps <- prepared <%= M.insert (sender auth) di
      total <- poolSize
      let sameVoteCount = M.size . M.filter (==di) $ ps
      sameHash <- hasSameHash di
      hasSent <- use hasPrepared
      when (3 * sameVoteCount > 2 * total && sameHash && not hasSent) $ do
        hasPrepared .= True
        setLock
        pk <- use prvkey
        seal <- commitmentSeal di pk
        yield =<< signMessage pk (Commit v di seal)
    IMsg auth (Commit v' di seal) -> when (v <= v') $ do
      cs <- committed <%= M.insert (sender auth) (di, seal)
      total <- poolSize
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
            let blockNo = blockDataNumber . blockBlockData $ blk
            recordMaxBlockNumber "pbft_commit" blockNo
            yield . ToCommit . addCommitmentSeals seals $ blk
    IMsg auth (RoundChange vn) -> when (_round v < _round vn) $ do
      let rn = _round vn
      rs <- roundChanged <%= M.insert (sender auth) rn
      total <- poolSize
      sentRN <- use pendingRound
      let sameRNCount = M.size . M.filter (== rn) $ rs
      when (3 * sameRNCount > total && Just rn > sentRN) $ do
        pendingRound .= Just rn
        pk <- use prvkey
        $logInfoS "blockstanbul/roundchange" "agreed change"
        yield =<< signMessage pk (RoundChange vn)
      when (3 * sameRNCount > 2 * total) $ do
        next <- use pendingRound
        case next of
          Nothing -> error "TODO(tim): a round was voted on without existing"
          Just r -> nextRound (Round r)
      return ()
    Timeout r' -> do
      case r' `compare` _round v of
        LT ->
          let msg = printf "Ignoring stale timeout for %v (now %v)" r' (_round v)
          in $logInfoS "blockstanbul" . T.pack $ msg
        EQ -> do
          $logWarnS "blockstanbul" . T.pack $ printf "Round %v timed out" r'
          $logInfoS "blockstanbul/roundchange" "timeout"
          roundChange
        GT -> error $ printf "We're in a time loop: %v was received at now=%v" r' (_round v)
    CommitResult (Left err) -> do
      $logWarnS "blockstanbul" err
      $logInfoS "blockstanbul/roundchange" "commit failure (how...)"
      clearLock
      roundChange
    CommitResult (Right hsh) -> do
      $logInfoS "blockstanbul" . T.pack $ "Successful block commit of " ++ format hsh
      lastParent .= Just hsh
      clearLock
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
              .| iterMC recordInEvent
              .| iterMC (inShortLog "blockstanbul/InShortLog")
              .| iterMC ($logDebugS "blockstanbul/InEvent" . T.pack . format)
              .| eventLoop ctx
              `fuseUpstream` (iterMC recordOutEvent
                           .| iterMC (outShortLog "blockstanbul/OutShortLog")
                           .| iterMC ($logDebugS "blockstanbul/OutEvent" . T.pack . format))
      (ctx', evs) <- runConduit $ fuseBoth base sinkList
      putBlockstanbulContext ctx'
      return evs

sendAllMessages :: (MonadIO m, MonadLogger m, HasBlockstanbulContext m) => [InEvent] -> m [OutEvent]
sendAllMessages wms = do
  out <- sendMessages wms
  $logDebugS "sendAllMessages" . T.pack $ format out
  case mapMaybe loopback out of
             [] -> return out
             wms' -> (out ++) <$> sendAllMessages wms'

currentView :: (HasBlockstanbulContext m) => m View
currentView = maybe (View (-1) (-1)) _view <$> getBlockstanbulContext

blockstanbulRunning :: HasBlockstanbulContext m => m Bool
blockstanbulRunning = isJust <$> getBlockstanbulContext

editVoted :: (MonadIO m, MonadLogger m, MonadState BlockstanbulContext m) => Block -> Address -> m ()
editVoted pp pr = do
  case extractBeneficiary pp of
    Nothing -> return()
    Just (bnef,vot) -> do
      -- insert the vote into map
      val <- uses voted $M.lookup bnef
      $logInfoS "blockstanbul/voting" . T.pack $
        "extractBeneficiary" ++ show val
      let unwrapVal = fromMaybe M.empty val
      let nval = M.insert pr vot unwrapVal
      voted %= M.insert bnef nval
      voted' <- use voted
      $logInfoS "blockstanbul/voting" . T.pack $
        "insert into voted map:" ++ show voted'

recordInEvent :: (MonadIO m) => InEvent -> m ()
recordInEvent ev = let inc txt = liftIO $ withLabel inEventMetric txt incCounter
  in case ev of
   IMsg _ Preprepare{} -> inc "preprepare_message"
   IMsg _ Prepare{} -> inc "prepare_message"
   IMsg _ Commit{} -> inc "commit_message"
   IMsg _ RoundChange{} -> inc "roundchange_message"
   Timeout{} -> inc "timeout"
   CommitResult{} -> inc "commit_result"
   UnannouncedBlock{} -> inc "unannounced_block"
   PreviousBlock{} -> inc "previous_block"
   NewBeneficiary{} -> inc "new_beneficiary"

recordOutEvent :: (MonadIO m) => OutEvent -> m ()
recordOutEvent ev = let inc txt = liftIO $ withLabel outEventMetric txt incCounter
  in case ev of
    OMsg _ Preprepare{} -> inc "preprepare_message"
    OMsg _ Prepare{} -> inc "prepare_message"
    OMsg _ Commit{} -> inc "commit_message"
    OMsg _ RoundChange{} -> inc "roundchange_message"
    ToCommit{} -> inc "to_commit_block"
    MakeBlockCommand -> inc "make_block_command"
    ResetTimer{} -> inc "reset_timer"
    GapFound{} -> inc "gap_found"
    LeadFound{} -> inc "lead_found"
    PendingVote{} -> inc" pending_vote"
