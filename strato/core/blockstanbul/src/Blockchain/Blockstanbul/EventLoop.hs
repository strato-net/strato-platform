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
import Blockchain.Strato.Model.Class (blockHash, blockHeader, blockHeaderBlockNumber)
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.Validator
import Conduit
import Control.Lens hiding (view)
import Control.Monad hiding (sequence)
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

roundChange :: (StateMachineM m) => ConduitM InEvent EOutEvent m ()
roundChange = do
  nextView <- uses view (over round (+ 1))
  pendingRound .= Just (_round nextView)
  rawMsg <- createRoundChangeMessage nextView
  valB <- use validatorBehavior
  self <- use selfAddr
  when (isJust self && valB) $ do
    msg <- signMessage rawMsg
    yieldR msg

nextRound :: (StateMachineM m) => NextType -> ConduitM InEvent EOutEvent m ()
nextRound nt = do
  case nt of
    Sequence s -> view . sequence .= s
    Round r -> do
      view . round .= r
      yieldR $ ResetTimer r
  use view >>= recordView
  vals <- use validators
  $logInfoS "nextRound/validators" . T.pack $ show vals
  thisR <- use $ view . round
  when (S.null vals) . liftIO $
    die "All participants voted out, consensus is stuck."
  let leader = (fromIntegral thisR `mod` S.size vals) `S.elemAt` vals
  proposer .= leader
  proposal .= Nothing
  self <- use selfAddr
  valB <- use validatorBehavior
  when (Just leader == fmap Validator self && valB) $ do
    lock <- use blockLock
    v <- use view
    case lock of
      Nothing -> use myBlock >>= \case
        Just myBlk | blockHeaderBlockNumber (blockHeader myBlk) == fromIntegral (v ^. sequence) + 1 -> do
          msg <- signMessage (Preprepare v myBlk)
          yieldR msg
        _ -> pure ()
      Just lb -> do
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
applyValidatorChanges BlockHeaderV2{..} = do
  validators %= (S.union $ S.fromList newValidators)
  validators %= (flip S.difference $ S.fromList removedValidators)

commitBlock :: StateMachineM m =>
               Block -> ConduitM InEvent EOutEvent m ()
commitBlock blk = do
  lift . applyValidatorChanges $ blockBlockData blk
  yieldR $ ToCommit blk
  let hsh = blockHash blk
  $logInfoS "blockstanbul" . T.pack $ "Successful block commit of " ++ format hsh
  lastParent .= Just hsh
  clearLock
  myBlock .= Nothing
  whenM (use hasPreprepared) $
    recordProposal
  s <- use $ view . sequence
  nextRound . Sequence $ s + 1

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
          seqNo <- use $ view . sequence
          eNextSeqNo <- lift $ lift $ runExceptT $ replayHistoricBlock realValidators seqNo blk
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
              $logInfoS "blockstanbul" . T.pack . printf "Accepting historical block #%d" $ blockNo
              commitBlock blk
        UnannouncedBlock blk' -> do
          -- this is for sending out a new block,
          -- may be a good candidtate for sending newCerts
          let blk = scrubConsensus blk'
          when flags_test_mode_bypass_blockstanbul $ do
            vs <- use validators
            let blockWithVs = addValidators (S.toList vs) blk
            pseal <- proposerSeal blockWithVs
            commitBlock $ addProposerSeal pseal blockWithVs
          ppl <- use proposal
          leader <- use proposer
          self <- use selfAddr
          myBlock ?= blk
          when (isNothing ppl && Just leader == fmap Validator self) $ do
            vs <- use validators
            let blockWithVs = addValidators (S.toList vs) blk
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
              Right () -> do
                hasPreprepared .= True
                proposal .= Just realSealed
                valB <- use validatorBehavior
                when (isJust self && valB) $ do
                  msg <- signMessage (Preprepare v realSealed)
                  yieldR msg
                  yieldR $ RunPreprepare realSealed
        PreprepareResponse decision -> case decision of
            AcceptPreprepare bh -> do
              self <- use selfAddr
              valB <- use validatorBehavior
              when (isJust self && valB) $ do
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
                case assertChainConsistency (_sequence v) wantParent pp of
                  Left err -> do
                    $logWarnS "blockstanbul/ppl" $ "Rejecting proposal: " <> err
                    $logInfoS "blockstanbul/roundchange" "chain inconsistency"
                    roundChange
                  Right () -> do
                    wasProposed <- isJust <$> use proposal
                    unless wasProposed $ do
                      yieldL $ OMsg auth ppp
                      proposal .= Just pp
                      self <- use selfAddr
                      valB <- use validatorBehavior
                      -- run in vm before sending prepare
                      when (isJust self && valB) . yieldR $ RunPreprepare pp
        IMsg auth ppp@(Prepare v' di) -> when (v <= v') $ do
          preparers <- use prepared
          unless (M.member (Validator $ sender auth) preparers) . yieldL $ OMsg auth ppp
          ps <- prepared <%= M.insert (Validator $ sender auth) di
          total <- poolSize
          let sameVoteCount = M.size . M.filter (== di) $ ps
          sameHash <- hasSameHash di
          hasSent <- use hasPrepared
          when (3 * sameVoteCount > 2 * total && sameHash && not hasSent) $ do
            hasPrepared .= True
            setLock
            seal <- commitmentSeal di
            self <- use selfAddr
            valB <- use validatorBehavior
            when (isJust self && valB) $ do
              msg <- signMessage (Commit v di seal)
              yieldR msg
        IMsg auth ccc@(Commit v' di seal) -> when (v <= v') $ do
          committors <- use committed
          unless (M.member (Validator $ sender auth) committors) . yieldL $ OMsg auth ccc
          cs <- committed <%= M.insert (Validator $ sender auth) (di, seal)
          total <- poolSize
          let sameVoteCount = M.size . M.filter ((== di) . fst) $ cs
          sameHash <- hasSameHash di
          -- TODO(tim): Is it necessary to check that we have prepared?
          hasSent <- use hasCommitted
          when (3 * sameVoteCount > 2 * total && sameHash && not hasSent) $ do
            hasCommitted .= True
            ppl <- use proposal
            case ppl of
              Nothing -> error "TODO(tim): Decide how to handle this"
              Just blk -> do
                let seals = map snd . M.elems $ cs
                let blockNo = number . blockBlockData $ blk
                recordMaxBlockNumber "pbft_commit" blockNo
                commitBlock $ addCommitmentSeals seals blk
        IMsg auth (RoundChange vn _) -> when (_round v < _round vn) $ do
          let rn = _round vn
          mSigners <- use $ roundChanged . at rn
          case S.member (Validator $ sender auth) <$> mSigners of
            Just True -> return ()
            _ -> do
              rs <- roundChanged <%= M.alter (Just . S.insert (Validator $ sender auth) . fromMaybe S.empty) rn
              total <- poolSize
              sentRN <- use pendingRound
              let sameRNCount = maybe 0 S.size . M.lookup rn $ rs
              rawMsg <- createRoundChangeMessage vn
              when (3 * sameRNCount > total && Just rn > sentRN) $ do
                pendingRound .= Just rn
                $logInfoS "blockstanbul/roundchange" "agreed change"
                valB <- use validatorBehavior
                self <- use selfAddr
                when (isJust self && valB) $ do
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
