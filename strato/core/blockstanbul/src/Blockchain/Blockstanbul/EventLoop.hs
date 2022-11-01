{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE OverloadedStrings #-}
module Blockchain.Blockstanbul.EventLoop where

import Conduit
import Control.Lens hiding (view)
import Control.Monad hiding (sequence)
import Control.Monad.Extra (whenM)
import Control.Monad.Trans.Except
import Control.Monad.State.Class
import Crypto.Random.Entropy (getEntropy)
import qualified Data.Map.Strict as M
import Data.Maybe
import qualified Data.Set as S
import qualified Data.Text as T
import Prelude hiding (round, sequence)
import Prometheus
import System.Exit
import Text.Printf

import Blockapps.Crossmon
import BlockApps.Logging

import Blockchain.Data.Block
import Blockchain.Data.DataDefs
import Blockchain.Blockstanbul.Authentication
import qualified Blockchain.Blockstanbul.HTTPAdmin as HA
import Blockchain.Blockstanbul.Messages
import Blockchain.Blockstanbul.Metrics
import Blockchain.Blockstanbul.Voting
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Class (blockHash)
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Text.Format


import Blockchain.Blockstanbul.StateMachine

yieldL :: Monad m => b -> ConduitM a (Either b c) m ()
yieldL = yield . Left

yieldR :: Monad m => c -> ConduitM a (Either b c) m ()
yieldR = yield . Right

yieldManyR :: Monad m => [c] -> ConduitM a (Either b c) m ()
yieldManyR = yieldMany . map Right


authorize :: (StateMachineM m) => InEvent -> ExceptT String m ()
authorize = \case
  IMsg (MsgAuth addr _) _ -> do
    ret <- uses validators (addr `S.member`)
    unless ret $ do
      let reason = "Rejecting message; sender not a validator: " ++ show addr
      $logWarnS "blockstanbul/auth" . T.pack $ reason
      throwE reason
  _ -> return ()


isAuthorized :: (StateMachineM m) => InEvent -> m AuthResult
isAuthorized iev = fmap (either AuthFailure (const AuthSuccess)) . runExceptT $ do
  doAuthn <- use productionAuth
  let authenticated = authenticate iev
      raiseInProd reason = when doAuthn $ do
        $logWarnS "blockstanbul/auth" . T.pack $ reason
        throwE reason
  unless authenticated $ do
    raiseInProd $ "Rejecting inevent; message failed authentication: " ++ show iev
  authorize iev
  case iev of
    NewBeneficiary (MsgAuth addr sig) (benf, dir, nonc) -> do
      -- Check nonce for replay attack
      slist <- use authSenders
      let ifAuthMember = M.member addr slist
          nonceAuth = Just nonc > M.lookup addr slist
          signAuth = Just addr == verifyBenfInfo (benf,dir,nonc) sig

      unless ifAuthMember $
        raiseInProd $ "Rejecting NewBeneficiary; Sender is not approved " ++ show addr
                   ++ " is not a authorized sender" ++ show slist
      unless nonceAuth $
        raiseInProd $ "Rejecting NewBeneficiary; Nonce is incorrect " ++ show nonc
      unless signAuth $
        raiseInProd $ "Rejecting NewBeneficiary; bad seal, address: " ++ show addr ++ " Seal: "
                   ++ show sig ++ " info: " ++ show (benf, dir, nonc) ++ " address decoded: "
                   ++ show (fromJust (verifyBenfInfo (benf,dir,nonc) sig))
    -- TODO(tim): RoundChange a Preprepare correctly signed by the proposer,
    -- but with incorrect extraData.
    IMsg _ (Preprepare _ pp) -> do
      vals <- use validators
      let payloadVals = S.fromList (getValidatorList pp)
          validatorsMatch = vals == payloadVals
          signatory = verifyProposerSeal pp =<< getProposerSeal pp
          signerExists = signatory `S.member` S.map Just vals
      unless signerExists $
        raiseInProd $ "Rejecting Preprepare; signer " ++ show (format <$> signatory)
                   ++ " is not a known validator"
      unless validatorsMatch $
        raiseInProd $ "Rejecting Preprepare; payload validators "
                   ++ show (S.map format payloadVals) ++ " are not expected validators "
                  ++ show (S.map format vals)
    IMsg (MsgAuth addr _) (Commit _ di seal) -> do
      let ret = Just addr == verifyCommitmentSeal di seal
      unless ret . raiseInProd $ "Rejecting Commit; bad seal"
    _ -> return () -- No specific auth for any other messages

assertChainConsistency :: Word256 -> Maybe Keccak256 -> Block -> Either T.Text ()
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

hasSameHash :: (StateMachineM m) => Keccak256 -> m Bool
hasSameHash di = uses proposal $ maybe False ((==di) . blockHash)

createRoundChangeMessage :: MonadIO m => View -> m TrustedMessage
createRoundChangeMessage vw = do
  nonce <- bytesToWord256 <$> liftIO (getEntropy 32)
  pure $ RoundChange vw nonce

roundChange :: (StateMachineM m) => ConduitM InEvent EOutEvent m ()
roundChange = do
  nextView <- uses view (over round (+1))
  pendingRound .= Just (_round nextView)
  rawMsg <- createRoundChangeMessage nextView
  valB <- use validatorBehavior
  when (valB) $ do
    msg <- signMessage rawMsg
    yieldR msg

nextRound :: (StateMachineM m) => NextType -> ConduitM InEvent EOutEvent m ()
nextRound nt = do
  --update validators list
  val <- uses validators S.toList
  vot <- use voted
  let (newVals, toDrop, toAdd) = (updateValidator val vot)
  validators .= S.fromList newVals
  when (val /= newVals) $ do
    yieldR $ ListOfValidators toDrop toAdd
  $logInfoS "blockstanbul/voting" . T.pack $
                 "nextRound: voted map" ++ show vot
  valNew <- use validators
  $logInfoS "blockstanbul/voting" . T.pack $
                 "nextRound: validators updated" ++ show valNew
  case nt of
    Sequence s -> view . sequence .= s
    Round r -> do
      view . round .= r
      yieldR $ ResetTimer r
  use view >>= recordView
  vals <- use validators
  thisR <- use $ view . round
  epocheck <- use $ view . sequence
  when (epocheck `mod` 10000 == 0) $ do
      voted .= M.empty
      $logInfoS "blockstanbul/voting" . T.pack $
        "nextRound: voted map reset to empty with epocheck = " ++ show epocheck
  when (S.null vals) . liftIO $
    die "All participants voted out, consensus is stuck."
  let leader = (fromIntegral thisR `mod` S.size vals) `S.elemAt` vals
  proposer .= leader
  proposal .= Nothing
  self <- use selfAddr
  when (leader == self) $ do
    lock <- use blockLock
    case lock of
      Nothing -> yieldR MakeBlockCommand
      Just lb -> do
        v <- use view
        valB <- use validatorBehavior
        when (valB) $ do
          msg <- signMessage (Preprepare v lb) 
          yieldR msg 

  prepared .= M.empty
  committed .= M.empty
  roundChanged %= M.dropWhileAntitone (<= thisR)

  hasPreprepared .= False
  hasCommitted .= False
  hasPrepared .= False
  pendingRound .= Nothing

  yieldR . NewCheckpoint =<< liftM4 Checkpoint (use view)
                                              (use voted)
                                              (uses validators S.toList)
                                              (uses authSenders M.keys)

eventLoop :: (MonadIO m, MonadLogger m, HasVault m) => BlockstanbulContext -> ConduitM InEvent EOutEvent m BlockstanbulContext
eventLoop ctx = execStateC ctx $ awaitForever $ \ev -> do
  debugShowCtx
  authz <- lift $ isAuthorized ev
  recordAuthResult authz
  v <- use view
  case authz of
   AuthFailure reason -> case ev of
      NewBeneficiary{} -> yieldR . VoteResponse $ HA.Rejected reason
      _ -> return ()
   AuthSuccess -> case ev of
    ValidatorBehaviorChange vc -> do
      case vc of
          ForcedValidator fv -> modify' $ validatorBehavior .~ fv
      valB <- use validatorBehavior
      $logInfoLS "blockstanbul/ValidatorBehaviorChange" valB

    ForcedConfigChange cc -> do
      $logWarnLS "blockstanbul/config_change" cc
      case cc of
        ForcedRound rn ->
          if rn >= _round v
            then nextRound (Round rn)
            else $logErrorS "blockstanbul/config_change" . T.pack $
                   printf "Refusing to move round backwards in time %d to %d" (_round v) rn
    NewBeneficiary (MsgAuth addr _) (benf, dir, nonc)  -> do
      authSenders %= M.insert addr nonc
      self <- use selfAddr 
      yieldManyR [PendingVote benf dir self, VoteResponse HA.Enqueued]
    PreviousBlock blk -> do
      realValidators <- use validators
      seqNo <- use $ view . sequence
      let eNextSeqNo = replayHistoricBlock realValidators seqNo blk
          blockNo = blockDataNumber . blockBlockData $ blk
      recordMaxBlockNumber "pbft_previousblock" blockNo
      case eNextSeqNo of
        Left err -> do
          rejectHistoric
          $logWarnS "blockstanbul" . T.pack
                      . printf "Rejecting historical block #%d: %s" blockNo $ err
        Right (_, props) -> do
          acceptHistoric
          $logInfoS "blockstanbul" . T.pack . printf "Accepting historical block #%d" $ blockNo
          editVoted blk props
          yieldR . ToCommit $ blk
    UnannouncedBlock blk' -> do
      let blk = truncateExtra blk'
      ppl <- use proposal
      leader <- use proposer
      self <- use selfAddr
      when (isNothing ppl && leader == self) $ do
        vs <- use validators
        let blockWithVs = addValidators vs blk
        pseal <- proposerSeal blockWithVs 
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
            yieldR MakeBlockCommand
          Right () -> do
            hasPreprepared .= True
            proposal .= Just realSealed
            valB <- use validatorBehavior
            when (valB) $ do
              msg <- signMessage (Preprepare v realSealed)
              yieldR msg
    IMsg auth ppp@(Preprepare v' pp) -> do
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
                yieldR $ GapFound (intSeq v) (intSeq v') (sender auth)
              when (_sequence v > _sequence v') $
                yieldR $ LeadFound (intSeq v) (intSeq v') (sender auth)
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
                  wasProposed <- isJust <$> use proposal
                  unless wasProposed . yieldL $ OMsg auth ppp
                  proposal .= Just pp
                  editVoted pp pr
                  valB <- use validatorBehavior
                  when (valB) $ do
                    msg <- signMessage (Prepare v (blockHash pp))
                    yieldR msg
    IMsg auth ppp@(Prepare v' di) -> when (v <= v') $ do
      preparers <- use prepared
      unless (M.member (sender auth) preparers) . yieldL $ OMsg auth ppp
      ps <- prepared <%= M.insert (sender auth) di
      total <- poolSize
      let sameVoteCount = M.size . M.filter (==di) $ ps
      sameHash <- hasSameHash di
      hasSent <- use hasPrepared
      when (3 * sameVoteCount > 2 * total && sameHash && not hasSent) $ do
        hasPrepared .= True
        setLock
        seal <- commitmentSeal di
        valB <- use validatorBehavior
        when (valB) $ do
          msg <- signMessage (Commit v di seal)
          yieldR msg
    IMsg auth ccc@(Commit v' di seal) -> when (v <= v') $ do
      committors <- use committed
      unless (M.member (sender auth) committors) . yieldL $ OMsg auth ccc
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
            yieldR . ToCommit . addCommitmentSeals seals $ blk
    IMsg auth (RoundChange vn _) -> when (_round v < _round vn) $ do
      let rn = _round vn
      mSigners <- use $ roundChanged . at rn
      case S.member (sender auth) <$> mSigners of
        Just True -> return ()
        _ -> do
          rs <- roundChanged <%= M.alter (Just . S.insert (sender auth) . fromMaybe S.empty) rn
          total <- poolSize
          sentRN <- use pendingRound
          let sameRNCount = maybe 0 S.size . M.lookup rn $ rs
          rawMsg <- createRoundChangeMessage vn
          when (3 * sameRNCount > total && Just rn > sentRN) $ do
            pendingRound .= Just rn
            $logInfoS "blockstanbul/roundchange" "agreed change"
            valB <- use validatorBehavior
            when (valB) $ do
              msg <- signMessage rawMsg
              yieldR msg
          when (3 * sameRNCount > 2 * total) $ do
            next <- use pendingRound
            case next of
              Nothing -> error "TODO(tim): a round was voted on without existing"
              Just r -> nextRound (Round r)
          yieldL $ OMsg auth rawMsg
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
      whenM (use hasPreprepared) $
        recordProposal
      s <- use $ view . sequence
      nextRound . Sequence $ s+1


loopback :: EOutEvent -> Maybe InEvent
loopback (Right (OMsg a m)) = Just $ IMsg a m
loopback _ = Nothing

sendMessages' :: (MonadIO m, MonadLogger m, HasBlockstanbulContext m, HasVault m) => [InEvent] -> m [EOutEvent]
sendMessages' wms = do
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
                           .| iterMC ($logDebugS "blockstanbul/OutEvent" . T.pack . format . fromE))
      (ctx', evs) <- runConduit $ fuseBoth base sinkList
      putBlockstanbulContext ctx'
      return evs

sendMessages :: (MonadIO m, MonadLogger m, HasBlockstanbulContext m, HasVault m) => [InEvent] -> m [OutEvent]
sendMessages = fmap (map fromE) . sendMessages'

sendAllMessages :: (MonadIO m, MonadLogger m, HasBlockstanbulContext m, HasVault m) => [InEvent] -> m [OutEvent]
sendAllMessages wms = do
  eout <- sendMessages' wms
  let out = fromE <$> eout 
  $logDebugS "sendAllMessages" . T.pack $ format out
  case mapMaybe loopback eout of
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
   ForcedConfigChange{} -> inc "forced_config_change"
   ValidatorBehaviorChange{} -> inc "validator_behavior_change"
   

recordOutEvent :: (MonadIO m) => EOutEvent -> m ()
recordOutEvent eev = let inc txt = liftIO $ withLabel outEventMetric txt incCounter
  in case fromE eev of
    OMsg _ Preprepare{} -> inc "preprepare_message"
    OMsg _ Prepare{} -> inc "prepare_message"
    OMsg _ Commit{} -> inc "commit_message"
    OMsg _ RoundChange{} -> inc "roundchange_message"
    ToCommit{} -> inc "to_commit_block"
    MakeBlockCommand -> inc "make_block_command"
    ResetTimer{} -> inc "reset_timer"
    GapFound{} -> inc "gap_found"
    LeadFound{} -> inc "lead_found"
    PendingVote{} -> inc "pending_vote"
    VoteResponse{} -> inc "vote_response"
    NewCheckpoint{} -> inc "new_checkpoint"
    ListOfValidators{} -> inc "new_validators"
