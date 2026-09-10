{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Blockstanbul.EventLoop where

import BlockApps.Crossmon
import BlockApps.Logging
import Blockchain.Blockstanbul.Authentication
import Blockchain.Blockstanbul.Messages
import Blockchain.Blockstanbul.Metrics
import Blockchain.Blockstanbul.Options (flags_test_mode_bypass_blockstanbul)
import Blockchain.Blockstanbul.StateMachine
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Class (blockHash, blockHeader, blockHeaderBlockNumber, blockHeaderVersion)
import SolidVM.Model.Delta (applyStakeDelta)
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.ProposerSelection
import Blockchain.Strato.Model.Validator
import Conduit
import Control.Lens hiding (view)
import Control.Monad hiding (sequence)
import Control.Monad.Composable.Vault
import Control.Monad.Extra (whenM)
import Control.Monad.State.Strict
import Control.Monad.Trans.Except
import Crypto.Random.Entropy (getEntropy)
import Data.List
import qualified Data.Map.Strict as M
import Data.Maybe
import qualified Data.Set as S
import qualified Data.Text as T
import Prometheus
import System.Exit
import Text.Format
import Text.Printf
import Text.ShortDescription
import Prelude hiding (round, sequence)

yieldL :: Monad m => b -> ConduitM a (Either b c) m ()
yieldL = yield . Left

yieldR :: Monad m => c -> ConduitM a (Either b c) m ()
yieldR = yield . Right

yieldManyR :: Monad m => [c] -> ConduitM a (Either b c) m ()
yieldManyR = yieldMany . map Right

authorize :: (StateMachineM m) => InEvent -> ExceptT String m ()
authorize = \case
  IMsg (MsgAuth cm _) _ -> do
    ret <- uses validators $ S.member (Validator cm)
    unless ret $ do
      let reason = "Rejecting message; sender not a validator: " ++ show cm
      $logWarnS "blockstanbul/auth" . T.pack $ reason
      throwE reason
  _ -> return ()

isAuthorized :: StateMachineM m => InEvent -> m AuthResult
isAuthorized iev = fmap (either AuthFailure (const AuthSuccess)) . runExceptT $ do
  doAuthn <- use productionAuth
  authenticated <- authenticate iev
  let raiseInProd reason = when doAuthn $ do
        $logWarnS "blockstanbul/auth" . T.pack $ reason
        throwE reason --debug statement?
  unless authenticated $ do
    raiseInProd $ "Rejecting inevent; message failed authentication: " ++ show iev
  authorize iev
  case iev of -- cases of valid and non valid input (for approval of messages and tx's?)
  -- TODO(tim): RoundChange a Preprepare correctly signed by the proposer,
  -- but with incorrect extraData.
    IMsg _ (Preprepare _ pp) -> do
      valSet <- use validators -- this is _validators from bloctanbul context?
      let mSignatory = verifyProposerSeal pp =<< getProposerSeal pp -- same convention getProposerSeal :: Block -> Maybe Signature
      case mSignatory of
        Nothing -> raiseInProd "Rejecting Preprepare; proposer seal could not be verified"
        Just signatory -> do
          let signerExists = Validator signatory `S.member` valSet
          unless signerExists $
            raiseInProd $
              "Rejecting Preprepare; signer " ++ formatAddressWithoutColor signatory
                ++ " is not a known validator"
    IMsg (MsgAuth addr _) (Commit _ di seal) -> do
      csOrError <- runExceptT $ verifyCommitmentSeal di seal
      case csOrError of
        Left _ -> raiseInProd $ "Rejecting Commit; signature could not be recovered"
        Right signatory -> do
          unless (signatory == addr) . raiseInProd $ "Rejecting Commit; bad seal"
    _ -> return () -- No specific auth for any other messages

-- I need to change most of the authentication.hs file becase it either uses block -> address or address -> signature

assertChainConsistency :: Word256 -> Maybe Keccak256 -> Block -> Either T.Text ()
assertChainConsistency seqNo wantParent blk = do
  let blkData = blockBlockData blk
      blkNo = fromIntegral . number $ blkData
      gotParent = parentHash blkData
  unless (seqNo + 1 == blkNo)
    . Left
    . T.pack
    $ printf "Rejecting block; block #%d is not required #%d" blkNo (seqNo + 1)
  when (isJust wantParent && wantParent /= Just gotParent)
    . Left
    . T.pack
    $ "Rejecting block; parent hash " ++ format gotParent ++ " is not required "
      ++ format (fromMaybe (error "assertChainConsistency") wantParent)
  Right ()

hasSameHash :: (StateMachineM m) => Keccak256 -> m Bool
hasSameHash di = uses proposal $ maybe False ((== di) . blockHash)

createRoundChangeMessage :: MonadIO m => View -> m TrustedMessage
createRoundChangeMessage vw = do
  nonce' <- bytesToWord256 <$> liftIO (getEntropy 32)
  pure $ RoundChange vw nonce'

-- Originate consensus messages only when this node is configured to vote
-- and is actually in the current validator set. validatorBehavior is the
-- kill switch; membership is the real gate. RPC nodes with the default
-- validatorBehavior=true must not vote.
mayVote :: StateMachineM m => m Bool
mayVote = do
  valB <- use validatorBehavior
  self <- use selfAddr
  vals <- use validators
  pure $ case self of
    Just addr | valB && Validator addr `S.member` vals -> True
    _ -> False

roundChange :: (StateMachineM m) => ConduitM InEvent EOutEvent m ()
roundChange = do
  nextView <- uses view (over round (+ 1))
  let target = _round nextView
  already <- use pendingRound
  pendingRound .= Just target
  -- One signed ROUNDCHANGE per target round. Retransmitting with a new
  -- nonce breaks P2P rlpHash dedup and is what produced the floods.
  when (already /= Just target) $
    whenM mayVote $ do
      rawMsg <- createRoundChangeMessage nextView
      msg <- signMessage rawMsg
      yieldR msg

-- | Stamp the consensus data this node is responsible for (the validator set,
-- and — once staking is active — the round and the stake weights in force) and
-- seal the block as its proposer.
stampAndSeal :: StateMachineM m => Block -> m Block
stampAndSeal blk = do
  vs <- use validators
  st <- use stakes
  v <- use view
  active <- gets stakingActiveNow
  let stampHeader h
        | active = setBlockStakes (M.toAscList st) $ setBlockRound (fromIntegral $ _round v) h
        | otherwise = h
      unsealed = addValidators (S.toList vs) $ scrubConsensus blk
      stamped = unsealed {blockBlockData = stampHeader (blockBlockData unsealed)}
  pseal <- proposerSeal stamped
  pure $ addProposerSeal pseal stamped

-- | Consensus checks on a proposed block's header that only apply once staking
-- is active: it must be a version-3 header whose round lies between the parent's
-- round and the proposing view's round (rounds persist across heights), whose
-- validator set and stake weights match ours, and whose seal was produced by
-- the proposer selected for that round.
checkProposalHeader :: BlockstanbulContext -> View -> Block -> Either T.Text ()
checkProposalHeader ctx v' pp
  | not (stakingActiveNow ctx) = Right ()
  | blockHeaderVersion hdr /= 3 =
      Left . T.pack $ printf "Rejecting proposal; block header version %d, expected 3" (blockHeaderVersion hdr)
  | hr > fromIntegral (_round v') =
      Left . T.pack $ printf "Rejecting proposal; header round %d is ahead of view round %d" hr (toInteger $ _round v')
  | hr < _lastRound ctx =
      Left . T.pack $ printf "Rejecting proposal; header round %d is behind the parent's round %d" hr (_lastRound ctx)
  | S.fromList (getBlockValidators hdr) /= _validators ctx =
      Left "Rejecting proposal; block validator set does not match ours"
  | M.fromList (getBlockStakes hdr) /= _stakes ctx =
      Left "Rejecting proposal; block stake weights do not match ours"
  | Just expected /= mSigner =
      Left . T.pack $ "Rejecting proposal; seal signer " ++ maybe "<none>" format mSigner
        ++ " is not the proposer selected for round " ++ show hr ++ ": " ++ format expected
  | otherwise = Right ()
  where
    hdr = blockBlockData pp
    hr = getBlockRound hdr
    mSigner = Validator <$> (verifyProposerSeal pp =<< getProposerSeal pp)
    expected = selectProposer (_chainId ctx) (nextHeight ctx) (_validators ctx) (_stakes ctx) (_lastRound ctx) hr

nextRound :: (StateMachineM m) => NextType -> ConduitM InEvent EOutEvent m ()
nextRound nt = do
  case nt of
    Sequence s -> view . sequence .= s
    Round r -> view . round .= r
  -- The timer is keyed by view, so it must be re-armed at every new height as
  -- well as at every new round (rounds persist across heights and only advance
  -- on timeouts).
  use view >>= yieldR . ResetTimer
  use view >>= recordView
  vals <- use validators
  $logDebugS "nextRound/validators" . T.pack $ shortDescription (S.toList vals)
  thisR <- use $ view . round
  when (S.null vals) . liftIO $
    die "All participants voted out, consensus is stuck."
  leader <- gets computeLeader
  proposer .= leader
  proposal .= Nothing
  self <- use selfAddr
  whenM mayVote $
    when (Just leader == fmap Validator self) $ do
      lock <- use blockLock
      v <- use view
      case lock of
        Nothing -> use myBlock >>= \case
          Just myBlk | blockHeaderBlockNumber (blockHeader myBlk) == fromIntegral (v ^. sequence) + 1 -> do
            -- our candidate was sealed for an earlier round; restamp and reseal it
            blk <- lift $ stampAndSeal myBlk
            myBlock ?= blk
            msg <- signMessage (Preprepare v blk)
            yieldR msg
          _ -> pure ()
        Just lb -> do
          -- a locked block is re-proposed unchanged (its hash must not change)
          msg <- signMessage (Preprepare v lb)
          yieldR msg

  prepared .= M.empty
  committed .= M.empty
  roundChanged %= M.dropWhileAntitone (<= thisR)

  hasPreprepared .= False
  hasCommitted .= False
  hasPrepared .= False
  pendingRound .= Nothing

  when (isJust self) $ isValidator .= (Validator (fromJust self) `elem` vals)

applyValidatorChanges :: MonadState BlockstanbulContext m =>
                         BlockHeader -> m ()
applyValidatorChanges BlockHeader{} = pure ()
applyValidatorChanges hdr = do
  let removed = getBlockRemovedValidators hdr
  validators %= (S.union . S.fromList $ getBlockNewValidators hdr)
  validators %= (flip S.difference $ S.fromList removed)
  stakes %= applyStakeDelta removed (M.fromList $ getBlockStakeUpdates hdr)

commitBlock :: StateMachineM m =>
               Block -> ConduitM InEvent EOutEvent m ()
commitBlock blk = do
  lift . applyValidatorChanges $ blockBlockData blk
  yieldR $ ToCommit blk
  let hsh = blockHash blk
      blockNo = blockHeaderBlockNumber $ blockHeader blk
  $logInfoS "blockstanbul" . T.pack $
    printf "Committed block #%d (%s)" blockNo (shortDescription hsh)
  lastParent .= Just hsh
  lastRound .= getBlockRound (blockBlockData blk)
  clearLock
  myBlock .= Nothing
  whenM (use hasPreprepared) $
    recordProposal
  s <- use $ view . sequence
  nextRound . Sequence $ s + 1

handleUnannouncedBlock :: StateMachineM m => Block -> ConduitM InEvent EOutEvent m ()
handleUnannouncedBlock blk' = do
  when flags_test_mode_bypass_blockstanbul $
    lift (stampAndSeal blk') >>= commitBlock
  ppl <- use proposal
  leader <- use proposer
  self <- use selfAddr
  sealedBlk <- lift $ stampAndSeal blk'
  myBlock ?= sealedBlk
  when (isNothing ppl && Just leader == fmap Validator self) $ do
    v <- use view
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
      Right () -> do
        hasPreprepared .= True
        proposal .= Just realSealed
        whenM mayVote $ do
          msg <- signMessage (Preprepare v realSealed)
          yieldR msg
          yieldR $ RunPreprepare realSealed

eventLoop ::
  ( MonadIO m,
    MonadLogger m,
    HasVault m
  ) =>
  BlockstanbulContext ->
  ConduitM InEvent EOutEvent m BlockstanbulContext
eventLoop ctx = execStateC ctx $
  awaitForever $ \ev -> do
    lift debugShowCtx
    authz <- lift $ isAuthorized ev
    recordAuthResult authz
    v <- use view
    case authz of
      AuthFailure _ -> return ()
      AuthSuccess -> case ev of
        ValidatorBehaviorChange vc -> do
          case vc of
            ForcedValidator fv -> modify' $ validatorBehavior .~ fv
          valB <- use validatorBehavior
          $logInfoLS "blockstanbul/ValidatorBehaviorChange" valB
        ValidatorChange val dir -> do
          modify' $
            validators
              %~ (if dir then S.insert else S.delete) val
          vals' <- use validators
          $logInfoLS "blockstanbul/ValidatorChange" . T.pack $
            concat
              [ "Validator ",
                format val,
                " was ",
                if dir then "added" else "removed",
                ". New validator set: ",
                show . map format . S.toList $ vals'
              ]
        ForcedConfigChange cc -> do
          $logWarnLS "blockstanbul/config_change" cc
          case cc of
            ForcedRound rn ->
              if rn >= _round v
                then nextRound (Round rn)
                else
                  $logErrorS "blockstanbul/config_change" . T.pack $
                    printf "Refusing to move round backwards in time %d to %d" (_round v) rn
            ForcedSequence s ->
              if s >= _sequence v
                then nextRound (Sequence s)
                else
                  $logErrorS "blockstanbul/config_change" . T.pack $
                    printf "Refusing to move sequence backwards in time %d to %d" (_sequence v) s
        PreviousBlock blk -> do
           -- nodes here will be syncing and looking to verify each block in the chain
          realValidators <- use validators
          realStakes <- use stakes
          activation <- use stakingActivation
          chainId' <- use chainId
          lastRound' <- use lastRound
          seqNo <- use $ view . sequence
          eNextSeqNo <- lift $ lift $ runExceptT $
            replayHistoricBlock realValidators realStakes activation chainId' lastRound' seqNo blk
          let blockNo = number . blockBlockData $ blk
          recordMaxBlockNumber "pbft_previousblock" blockNo
          case eNextSeqNo of
            Left err -> do
              rejectHistoric
              $logErrorS "blockstanbul" . T.pack
                . printf "Rejecting historical block #%d: %s" blockNo
                $ err
              yieldR $ FailedHistoric blk
            Right _ -> do
              acceptHistoric
              $logDebugS "blockstanbul" . T.pack . printf "Accepting historical block #%d" $ blockNo
              commitBlock blk
        UnannouncedBlock blk' -> do
          -- this is for sending out a new block,
          -- may be a good candidtate for sending newCerts
          active <- gets stakingActiveNow
          let hdrVersion = blockHeaderVersion (blockBlockData blk')
          if active && hdrVersion /= 3
            then $logErrorS "blockstanbul" . T.pack $
              "Ignoring unannounced block with header version " ++ show hdrVersion
                ++ "; staking is active but the block was not built as version 3 (check stakingActivationBlock)"
            else handleUnannouncedBlock blk'
        PreprepareResponse decision -> case decision of
            AcceptPreprepare bh -> do
              whenM mayVote $ do
                msg <- signMessage (Prepare v bh)
                yieldR msg
            RejectPreprepare -> roundChange
        IMsg auth ppp@(Preprepare v' pp) -> do
          pr <- use proposer
          mBlockLock <- use blockLock
          case () of
            ()
              | Validator (sender auth) /= pr ->
                $logWarnS "blockstanbul/ppl" . T.pack $
                  "Rejecting proposal: proposer " ++ format (Validator $ sender auth) ++ " is not " ++ format pr
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
                curCtx <- get
                case assertChainConsistency (_sequence v) wantParent pp >> checkProposalHeader curCtx v' pp of
                  Left err -> do
                    $logWarnS "blockstanbul/ppl" $ "Rejecting proposal: " <> err
                    $logInfoS "blockstanbul/roundchange" "chain inconsistency"
                    roundChange
                  Right () -> do
                    wasProposed <- isJust <$> use proposal
                    unless wasProposed $ do
                      yieldL $ OMsg auth ppp
                      proposal .= Just pp
                      -- run in vm before sending prepare
                      whenM mayVote . yieldR $ RunPreprepare pp
        IMsg auth ppp@(Prepare v' di) -> when (v <= v') $ do
          preparers <- use prepared
          unless (M.member (Validator $ sender auth) preparers) . yieldL $ OMsg auth ppp
          ps <- prepared <%= M.insert (Validator $ sender auth) di
          weights <- gets currentVoteWeights
          let quorum = hasSupermajority weights . M.keysSet . M.filter (== di) $ ps
          sameHash <- hasSameHash di
          hasSent <- use hasPrepared
          when (quorum && sameHash && not hasSent) $ do
            hasPrepared .= True
            setLock
            seal <- commitmentSeal di
            whenM mayVote $ do
              msg <- signMessage (Commit v di seal)
              yieldR msg
        IMsg auth ccc@(Commit v' di seal) -> when (v <= v') $ do
          committors <- use committed
          unless (M.member (Validator $ sender auth) committors) . yieldL $ OMsg auth ccc
          cs <- committed <%= M.insert (Validator $ sender auth) (di, seal)
          weights <- gets currentVoteWeights
          let quorum = hasSupermajority weights . M.keysSet . M.filter ((== di) . fst) $ cs
          sameHash <- hasSameHash di
          -- TODO(tim): Is it necessary to check that we have prepared?
          hasSent <- use hasCommitted
          when (quorum && sameHash && not hasSent) $ do
            hasCommitted .= True
            ppl <- use proposal
            case ppl of
              Nothing -> error "TODO(tim): Decide how to handle this"
              Just blk -> do
                let seals = map snd . M.elems $ cs
                let blockNo = number . blockBlockData $ blk
                recordMaxBlockNumber "pbft_commit" blockNo
                commitBlock $ addCommitmentSeals seals blk
        IMsg auth rc@(RoundChange vn _) -> do
          let intSeq = fromIntegral . _sequence
          when (_sequence v < _sequence vn) $
            yieldR $ GapFound (intSeq v) (intSeq vn) (sender auth)
          when (_sequence v == _sequence vn && _round v < _round vn) $ do
            let rn = _round vn
            mSigners <- use $ roundChanged . at rn
            case S.member (Validator $ sender auth) <$> mSigners of
              Just True -> return ()
              _ -> do
                rs <- roundChanged <%= M.alter (Just . S.insert (Validator $ sender auth) . fromMaybe S.empty) rn
                weights <- gets currentVoteWeights
                sentRN <- use pendingRound
                let voters = fromMaybe S.empty $ M.lookup rn rs
                when (hasMinority weights voters && Just rn > sentRN) $ do
                  pendingRound .= Just rn
                  $logInfoS "blockstanbul/roundchange" "agreed change"
                  whenM mayVote $ do
                    rawMsg <- createRoundChangeMessage vn
                    msg <- signMessage rawMsg
                    yieldR msg
                when (hasSupermajority weights voters) $ do
                  next <- use pendingRound
                  case next of
                    Nothing -> error "TODO(tim): a round was voted on without existing"
                    Just r -> nextRound (Round r)
                -- Gossip the inbound message unchanged. A new nonce would
                -- defeat P2P rlpHash dedup and amplify every vote.
                yieldL $ OMsg auth rc
                return ()
        Timeout tv -> case _sequence tv `compare` _sequence v of
          LT -> $logInfoS "blockstanbul" . T.pack $
            printf "Ignoring stale timeout for %s (now %s)" (format tv) (format v)
          GT -> $logWarnS "blockstanbul" . T.pack $
            printf "Ignoring timeout for a future sequence %s (now %s)" (format tv) (format v)
          EQ -> case _round tv `compare` _round v of
            LT ->
              let msg = printf "Ignoring stale timeout for %v (now %v)" (_round tv) (_round v)
               in $logInfoS "blockstanbul" . T.pack $ msg
            EQ -> do
              $logWarnS "blockstanbul" . T.pack $ printf "Round %v timed out" (_round tv)
              $logInfoS "blockstanbul/roundchange" "timeout"
              roundChange
            GT -> error $ printf "We're in a time loop: %v was received at now=%v" (_round tv) (_round v)

loopback :: EOutEvent -> Maybe InEvent
loopback (Right (OMsg a m)) = Just $ IMsg a m
loopback _ = Nothing

sendMessages' ::
  ( MonadIO m,
    MonadLogger m,
    HasBlockstanbulContext m,
    HasVault m
  ) =>
  [InEvent] ->
  m [EOutEvent]
sendMessages' wms = do
  -- It may be somewhat confusing, but there are actually 2 StateTs with BlockstanbulContext
  -- Every run of the conduit has one, but the outer monad preserves the context between runs.
  ctx <- getBlockstanbulContext
  let base =
        yieldMany wms
          .| iterMC recordInEvent
          .| iterMC (inShortLog "blockstanbul/InShortLog")
          .| iterMC ($logDebugS "blockstanbul/InEvent" . T.pack . format)
          .| eventLoop ctx
          `fuseUpstream` ( iterMC recordOutEvent
                             .| iterMC (outShortLog "blockstanbul/OutShortLog")
                             .| iterMC ($logDebugS "blockstanbul/OutEvent" . T.pack . format . fromE)
                         )
  (ctx', evs) <- runConduit $ fuseBoth base sinkList
  putBlockstanbulContext ctx'

  recordValidator (_isValidator ctx') (_validatorBehavior ctx')
  forM_ (_selfAddr ctx') $ recordNodeIdentity . T.pack . formatAddressWithoutColor

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
currentView = _view <$> getBlockstanbulContext

recordInEvent :: (MonadIO m) => InEvent -> m ()
recordInEvent ev =
  let inc txt = liftIO $ withLabel inEventMetric txt incCounter
   in case ev of
        IMsg _ Preprepare {} -> inc "preprepare_message"
        IMsg _ Prepare {} -> inc "prepare_message"
        IMsg _ Commit {} -> inc "commit_message"
        IMsg _ RoundChange {} -> inc "roundchange_message"
        Timeout {} -> inc "timeout"
        UnannouncedBlock {} -> inc "unannounced_block"
        PreviousBlock {} -> inc "previous_block"
        PreprepareResponse {} -> inc "preprepare_response"
        ForcedConfigChange {} -> inc "forced_config_change"
        ValidatorBehaviorChange {} -> inc "validator_behavior_change"
        ValidatorChange {} -> inc "validator_change"

recordOutEvent :: (MonadIO m) => EOutEvent -> m ()
recordOutEvent eev =
  let inc txt = liftIO $ withLabel outEventMetric txt incCounter
   in case fromE eev of
        OMsg _ Preprepare {} -> inc "preprepare_message"
        OMsg _ Prepare {} -> inc "prepare_message"
        OMsg _ Commit {} -> inc "commit_message"
        OMsg _ RoundChange {} -> inc "roundchange_message"
        ToCommit {} -> inc "to_commit_block"
        FailedHistoric {} -> inc "failed_historic"
        ResetTimer {} -> inc "reset_timer"
        GapFound {} -> inc "gap_found"
        LeadFound {} -> inc "lead_found"
        RunPreprepare {} -> inc "run_preprepare"
