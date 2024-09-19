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
import BlockApps.X509.Certificate
import Blockchain.Blockstanbul.Authentication
import Blockchain.Blockstanbul.Messages
import Blockchain.Blockstanbul.Metrics
import Blockchain.Blockstanbul.StateMachine
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Class (blockHash, DummyCertRevocation(..))
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Conduit
import Control.Arrow ((&&&))
import Control.Lens hiding (view)
import Control.Monad hiding (sequence)
import qualified Control.Monad.Change.Alter as A
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
    ret <- uses validators $ S.member (chainMemberParsedSetToValidator cm)
    unless ret $ do
      let reason = "Rejecting message; sender not a validator: " ++ show cm
      $logWarnS "blockstanbul/auth" . T.pack $ reason
      throwE reason
  _ -> return ()

isAuthorized :: (StateMachineM m, (Address `A.Alters` X509CertInfoState) m) => InEvent -> m AuthResult
isAuthorized iev = fmap (either AuthFailure (const AuthSuccess)) . runExceptT $ do
  doAuthn <- use productionAuth
  authenticated <- authenticate iev --InEvent (benf is a (ChainMemberParsedSet, Bool,Int))
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
          mChainMember <- fmap (chainMemberParsedSetToValidator . getChainMemberFromX509) <$> getX509FromAddress signatory
          let signerExists = maybe False (`S.member` valSet) mChainMember
          unless signerExists $
            raiseInProd $
              "Rejecting Preprepare; signer " ++ formatAddressWithoutColor signatory
                ++ " is not a known validator"
    IMsg (MsgAuth addr _) (Commit _ di seal) -> do
      csOrError <- runExceptT $ verifyCommitmentSeal di seal 
      case csOrError of
        Left _ -> raiseInProd $ "Rejecting Commit; signature could not be recovered"
        Right signatory -> do
          mChainMember <- lift $ runExceptT $ fmap getChainMemberFromX509 <$> getX509FromAddress signatory
          let ret =
                case mChainMember of
                  Left (_ :: String) -> False
                  Right Nothing -> False
                  Right (Just val) -> val == addr
          unless ret . raiseInProd $ "Rejecting Commit; bad seal"
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
  self <- use selfCert
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
  self <- use selfCert
  when (Just leader == fmap chainMemberParsedSetToValidator self) $ do
    lock <- use blockLock
    case lock of
      Nothing -> yieldR MakeBlockCommand
      Just lb -> do
        v <- use view
        valB <- use validatorBehavior
        when (isJust self && valB) $ do
          msg <- signMessage (Preprepare v lb)
          yieldR msg

  prepared .= M.empty
  committed .= M.empty
  roundChanged %= M.dropWhileAntitone (<= thisR)

  hasPreprepared .= False
  hasCommitted .= False
  hasPrepared .= False
  pendingRound .= Nothing

  when (isJust self) $ isValidator .= (chainMemberParsedSetToValidator (fromJust self) `elem` vals)

  yieldR . NewCheckpoint
    =<< liftA2
      Checkpoint
      (use view)
      (uses validators S.toList)

applyValidatorAndCertChanges ::
  ( (Address `A.Alters` X509CertInfoState) m
  , MonadState BlockstanbulContext m
  ) =>
  BlockHeader ->
  m ()
applyValidatorAndCertChanges BlockHeader{} = pure ()
applyValidatorAndCertChanges BlockHeaderV2{..} = do
  myAddr <- use selfAddr
  let mMyNewCert = find (\c -> Just (userAddress (x509CertToCertInfoState c)) == myAddr) newCerts
  when (isJust mMyNewCert) $ selfCert .= ((getChainMemberFromX509 . x509CertToCertInfoState) <$> mMyNewCert)
  A.insertMany (A.Proxy @X509CertInfoState) . M.fromList $
    (userAddress &&& id) . x509CertToCertInfoState <$> newCerts
  A.deleteMany (A.Proxy @X509CertInfoState) $
    (\(DummyCertRevocation a) -> a) <$> revokedCerts
  validators %= (S.union $ S.fromList newValidators)
  validators %= (flip S.difference $ S.fromList removedValidators)

commitBlock ::
  ( (Address `A.Alters` X509CertInfoState) m
  , StateMachineM m
  ) =>
  Block ->
  ConduitM InEvent EOutEvent m ()
commitBlock blk = do
  lift . applyValidatorAndCertChanges $ blockBlockData blk
  yieldR $ ToCommit blk
  let hsh = blockHash blk
  $logInfoS "blockstanbul" . T.pack $ "Successful block commit of " ++ format hsh
  lastParent .= Just hsh
  clearLock
  whenM (use hasPreprepared) $
    recordProposal
  s <- use $ view . sequence
  nextRound . Sequence $ s + 1

instance (Address `A.Alters` X509CertInfoState) m => (Address `A.Alters` X509CertInfoState) (StateT BlockstanbulContext m) where
  lookup p   = lift . A.lookup p
  insert p k = lift . A.insert p k
  delete p   = lift . A.delete p

instance (Address `A.Alters` X509CertInfoState) m => (Address `A.Alters` X509CertInfoState) (ExceptT String m) where
  lookup p = lift . A.lookup p
  insert p k = lift . A.insert p k
  delete p   = lift . A.delete p

instance (Address `A.Alters` X509CertInfoState) m => (A.Selectable Address X509CertInfoState) (ExceptT e m) where
  select p = lift . A.lookup p



eventLoop ::
  ( MonadIO m,
    MonadLogger m,
    HasVault m,
    (Address `A.Alters` X509CertInfoState) m
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
              $logWarnS "blockstanbul" . T.pack
                . printf "Rejecting historical block #%d: %s" blockNo
                $ err
              yieldR $ FailedHistoric blk
            Right _ -> do
              network' <- use network
              lift . validatorTimingHack network' $ number (blockBlockData blk)
              acceptHistoric
              $logInfoS "blockstanbul" . T.pack . printf "Accepting historical block #%d" $ blockNo
              commitBlock blk
        UnannouncedBlock blk' -> do
          -- this is for sending out a new block,
          -- may be a good candidtate for sending newCerts
          let blk = scrubConsensus blk'
          ppl <- use proposal
          leader <- use proposer
          self <- use selfCert
          when (isNothing ppl && Just leader == fmap chainMemberParsedSetToValidator self) $ do
            vs <- use validators
            let blockWithVs = addValidators (ChainMembers $ S.map validatorToChainMemberParsedSet vs) blk
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
                when (isJust self && valB) $ do
                  msg <- signMessage (Preprepare v realSealed)
                  yieldR msg
                  yieldR $ RunPreprepare realSealed
        PreprepareResponse decision -> case decision of 
            AcceptPreprepare bh -> do 
              self <- use selfCert
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
              | chainMemberParsedSetToValidator (sender auth) /= pr ->
                $logWarnS "blockstanbul/ppl" . T.pack $
                  "Rejecting proposal: proposer " ++ format (chainMemberParsedSetToValidator $ sender auth) ++ " is not " ++ format pr
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
                      self <- use selfCert
                      valB <- use validatorBehavior
                      -- run in vm before sending prepare
                      when (isJust self && valB) . yieldR $ RunPreprepare pp
        IMsg auth ppp@(Prepare v' di) -> when (v <= v') $ do
          preparers <- use prepared
          unless (M.member (chainMemberParsedSetToValidator $ sender auth) preparers) . yieldL $ OMsg auth ppp
          ps <- prepared <%= M.insert (chainMemberParsedSetToValidator $ sender auth) di
          total <- poolSize
          let sameVoteCount = M.size . M.filter (== di) $ ps
          sameHash <- hasSameHash di
          hasSent <- use hasPrepared
          when (3 * sameVoteCount > 2 * total && sameHash && not hasSent) $ do
            hasPrepared .= True
            setLock
            seal <- commitmentSeal di
            self <- use selfCert
            valB <- use validatorBehavior
            when (isJust self && valB) $ do
              msg <- signMessage (Commit v di seal)
              yieldR msg
        IMsg auth ccc@(Commit v' di seal) -> when (v <= v') $ do
          committors <- use committed
          unless (M.member (chainMemberParsedSetToValidator $ sender auth) committors) . yieldL $ OMsg auth ccc
          cs <- committed <%= M.insert (chainMemberParsedSetToValidator $ sender auth) (di, seal)
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
          case S.member (chainMemberParsedSetToValidator $ sender auth) <$> mSigners of
            Just True -> return ()
            _ -> do
              rs <- roundChanged <%= M.alter (Just . S.insert (chainMemberParsedSetToValidator $ sender auth) . fromMaybe S.empty) rn
              total <- poolSize
              sentRN <- use pendingRound
              let sameRNCount = maybe 0 S.size . M.lookup rn $ rs
              rawMsg <- createRoundChangeMessage vn
              when (3 * sameRNCount > total && Just rn > sentRN) $ do
                pendingRound .= Just rn
                $logInfoS "blockstanbul/roundchange" "agreed change"
                valB <- use validatorBehavior
                self <- use selfCert
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
    HasVault m,
    (Address `A.Alters` X509CertInfoState) m
  ) =>
  [InEvent] ->
  m [EOutEvent]
sendMessages' wms = do
  -- It may be somewhat confusing, but there are actually 2 StateTs with BlockstanbulContext
  -- Every run of the conduit has one, but the outer monad preserves the context between runs.
  mCtx <- getBlockstanbulContext
  case mCtx of
    Nothing -> do
      $logErrorS "blockstanbul" "cannot send messages without a BlockstanbulContext"
      return []
    Just ctx -> do
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

sendMessages :: (MonadIO m, MonadLogger m, HasBlockstanbulContext m, HasVault m, (Address `A.Alters` X509CertInfoState) m) => [InEvent] -> m [OutEvent]
sendMessages = fmap (map fromE) . sendMessages'

sendAllMessages :: (MonadIO m, MonadLogger m, HasBlockstanbulContext m, HasVault m, (Address `A.Alters` X509CertInfoState) m) => [InEvent] -> m [OutEvent]
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
        MakeBlockCommand -> inc "make_block_command"
        ResetTimer {} -> inc "reset_timer"
        GapFound {} -> inc "gap_found"
        LeadFound {} -> inc "lead_found"
        NewCheckpoint {} -> inc "new_checkpoint"
        RunPreprepare {} -> inc "run_preprepare"

validatorTimingHack :: (MonadState BlockstanbulContext m)  =>
                       String -> Integer -> m ()
validatorTimingHack "mercata" blockNumber = validatorTimingHackMercata blockNumber
validatorTimingHack "mercata-hydrogen" blockNumber = validatorTimingHackMercataHydrogen blockNumber
validatorTimingHack "mercata-uranium" blockNumber = validatorTimingHackMercataUranium blockNumber
validatorTimingHack _ _ = do
  return ()


validatorTimingHackMercata :: (MonadState BlockstanbulContext m)  =>
                              Integer -> m ()
validatorTimingHackMercata = \case
  5255 -> modify' $ validators %~ S.insert "service-account-io-stratomercata-dnorwood"
  5256 -> modify' $ validators %~ S.insert "service-account-io-stratomercata-witmk"
  5257 -> modify' $ validators %~ S.insert "service-account-io-stratomercata-jpowell"
  5258 -> modify' $ validators %~ S.insert "service-account-io-stratomercata-ChessGM9"
  5259 -> modify' $ validators %~ S.insert "service-account-io-stratomercata-aaa"
  5260 -> modify' $ validators %~ S.insert "service-account-io-stratomercata-trouble"
  5261 -> modify' $ validators %~ S.insert "service-account-io-stratomercata-dsnallapu"
  5271 -> modify' $ validators %~ S.insert "dustin-node"
  5276 -> modify' $ validators %~ S.insert "service-account-io-stratomercata-kierensnode"
  5277 -> modify' $ validators %~ S.insert "service-account-io-stratomercata-wongway"
  5288 -> modify' $ validators %~ S.delete "service-account-io-stratomercata-dnorwood"
  6099 -> modify' $ validators %~ S.insert "service-account-io-stratomercata-tyson"
  7369 -> modify' $ validators %~ S.insert "service-account-io-stratomercata-neel"
  7589 -> modify' $ validators %~ S.insert "service-account-io-stratomercata-drewbaby"
  7673 -> modify' $ validators %~ S.insert "service-account-io-stratomercata-michael"
  7683 -> modify' $ validators %~ S.insert "service-account-io-stratomercata-drebbel"
  7893 -> modify' $ validators %~ S.insert "service-account-io-stratomercata-keepeth"
  7915 -> modify' $ validators %~ S.insert "service-account-io-stratomercata-dgs"
  7976 -> modify' $ validators %~ S.insert "service-account-io-mercata-dgs"
  7977 -> modify' $ validators %~ S.insert "service-account-io-stratomercata-goldberg"
  8171 -> modify' $ validators %~ S.insert "service-account-Io-stratomercata-hasanthevalidator"
  8172 -> modify' $ validators %~ S.insert "service-account-Io-stratomercata-numbatwopencil"
  8315 -> modify' $ validators %~ S.insert "service-account-io-stratomercata-jgonzo"
  8317 -> modify' $ validators %~ S.insert "service-account-io-stratomercata-jacoguzo"
  8320 -> modify' $ validators %~ S.insert "service-account-io-stratomercata-zeek"
  8323 -> modify' $ validators %~ S.insert "service-account-io-stratomercata-mecmo4mopm"
  8324 -> modify' $ validators %~ S.insert "service-account-io-stratomercata-goldbacktoken"
  8325 -> modify' $ validators %~ S.insert "service-account-io-stratomercata-itaugmentation"
  8575 -> modify' $ validators %~ S.insert "service-account-io-stratomercata-vinfra"
  8576 -> modify' $ validators %~ S.insert "service-account-io-stratomercata-bible"
  8743 -> modify' $ validators %~ S.insert "jamrose.stratomercata.io"
  8914 -> modify' $ validators %~ S.insert "service-account-io-stratomercata-dttr1"
  8921 -> modify' $ validators %~ S.insert "service-account-io-stratomercata-dttr2"
  11265 -> modify' $ validators %~ S.delete "service-account-Io-stratomercata-hasanthevalidator"
  11266 -> modify' $ validators %~ S.delete "service-account-Io-stratomercata-numbatwopencil"
  11271 -> modify' $ validators %~ S.delete "service-account-io-stratomercata-jacoguzo"
  11275 -> modify' $ validators %~ S.delete "service-account-io-stratomercata-dgs"
  11714 -> modify' $ validators %~ S.insert "illerchiller.com"
  11800 -> modify' $ validators %~ S.insert "greenrubric.openwealthfi.com"
  11801 -> modify' $ validators %~ S.insert "events34.openwealthfi.com"
  11804 -> modify' $ validators %~ S.insert "coach.instanodes.io"
  11805 -> modify' $ validators %~ S.insert "joyz.openwealthfi.com"
  _ -> return ()
  

validatorTimingHackMercataHydrogen :: (MonadState BlockstanbulContext m)  =>
                               Integer -> m ()
validatorTimingHackMercataHydrogen = \case
  32424 -> modify' $ validators %~ S.insert "service-account-io-stratomercata-wongway"
  32444 -> modify' $ validators %~ S.insert "service-account-io-stratomercata-kierensnode"
  32644 -> modify' $ validators %~ S.insert "dustin-node"
  32705 -> modify' $ validators %~ S.delete "dustin-node"
  32706 -> modify' $ validators %~ S.delete "service-account-io-stratomercata-kierensnode"
  32707 -> modify' $ validators %~ S.delete "service-account-io-stratomercata-wongway"
  33128 -> modify' $ validators %~ S.insert "Multinode302"
  33179 -> modify' $ validators %~ S.delete "Multinode302"
  37598 -> modify' $ validators %~ S.insert "dmoney-testnet2"
  43711 -> modify' $ validators %~ S.delete "dmoney-testnet2"
  _ -> return ()

validatorTimingHackMercataUranium :: (MonadState BlockstanbulContext m)  => Integer -> m ()
validatorTimingHackMercataUranium = \case
  5 -> modify' $ validators %~ S.insert "mercata-devnet-node5"
  6 -> modify' $ validators %~ S.delete "mercata-devnet-node5"
  145 -> modify' $ validators %~ S.insert "mercata-devnet-node6"
  205 -> modify' $ validators %~ S.delete "mercata-devnet-node6"
  _ -> return ()
