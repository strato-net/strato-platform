{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DefaultSignatures #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}

{-# OPTIONS -fno-warn-orphans #-}

module Blockchain.Sequencer.Monad
  ( MonadBlockstanbul,
    Modification(..),
    SequencerContext (..),
    SequencerConfig (..),
    SequencerM (..),
    SequencerRow,
    BlockPeriod (..),
    RoundPeriod (..),
    runSequencerM,
    commitSequencerState,
    pairToVmTx,
    createFirstTimer,
    createNewTimer,
    createNewViewTimer,
    carryViewTimer,
    updateViewTimer,
    fuseChannels,
    seenTransactionDB,
    blockstanbulContext,
    latestViewAndProposal
  )
where

import BlockApps.Init ()
import BlockApps.Logging
import Blockchain.Blockstanbul
import Blockchain.Constants
import Blockchain.Model.SyncState
import Blockchain.Data.Block
import Blockchain.EthConf
import Blockchain.Model.WrappedBlock
import Blockchain.Sequencer.CablePackage
import Blockchain.Sequencer.DB.DependentBlockDB
import Blockchain.Sequencer.DB.SeenTransactionDB
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import Blockchain.SyncDB
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Validator
import qualified Blockchain.Strato.RedisBlockDB as RBDB
import ClassyPrelude (atomically, deepseq)
import Conduit
import Control.Concurrent.AlarmClock
import Control.Concurrent.STM.TMChan
import Control.Lens
import Control.Monad (unless, when)
import Control.Monad.Catch (MonadCatch, MonadMask)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Base (AccessibleEnv, Eff, InternalState, Logger, ReaderEnv, StateCell, evalStateEff, withReaderEnv, withResources)
import Control.Monad.Composable.Streaming
import Control.Monad.Composable.Vault (HasVault, VaultData, runVaultM)
import Control.Monad.Reader
import Control.Monad.State
import Data.Conduit.TMChan
import Data.IORef
import Data.Maybe
import qualified Data.Set as S
import Data.String
import qualified Data.Text as T
import Data.Time.Clock
import qualified Database.LevelDB as LDB
import System.Directory (createDirectoryIfMissing)
import Text.Format
import Prelude hiding (round)
import Prometheus (MonadMonitor)

data Modification a = Modification a | Deletion deriving (Show)

-- | The no-proposal / no-commit timer armed for a view: when it was armed (a
-- new transaction arrived), when it is next due, and its clock.
data ViewTimer = ViewTimer
  { vtView :: View,
    vtArmedAt :: UTCTime,
    vtDue :: UTCTime,
    vtClock :: AlarmClock UTCTime
  }

data SequencerContext = SequencerContext
  { _seenTransactionDB :: !SeenTransactionDB,
    _blockstanbulContext :: BlockstanbulContext,
    _latestViewAndProposal :: IORef (View, Maybe Block),
    -- | The view timer currently armed, if any. Keeps 'createNewViewTimer' to
    -- one live AlarmClock per view.
    _armedViewTimer :: IORef (Maybe ViewTimer),
    -- | The round timer's one shared AlarmClock (allocated on first use), and
    -- the (view, fire time) it is currently armed for. Keeps 'createNewTimer'
    -- to a single live AlarmClock no matter how many times it is re-armed.
    _roundTimerClock :: IORef (Maybe (AlarmClock UTCTime)),
    _armedRoundTimer :: IORef (Maybe (View, UTCTime)),
    -- | The best sequenced block not yet published to Redis. p2p and a
    -- restarting sequencer read Redis as "what is durably sequenced", so it
    -- is only published by 'commitSequencerState', after the block's output.
    _pendingBestSequencedBlock :: Maybe BestSequencedBlock
  }

makeLenses ''SequencerContext

type MonadBlockstanbul m =
  ( MonadIO m,
    HasBlockstanbulContext m,
    Mod.Accessible (IORef (View, Maybe Block)) m,
    Mod.Accessible (IORef (Maybe ViewTimer)) m,
    Mod.Accessible (IORef (Maybe (AlarmClock UTCTime))) m,
    Mod.Accessible (IORef (Maybe (View, UTCTime))) m,
    Mod.Accessible (TMChan View) m,
    Mod.Accessible BlockPeriod m,
    Mod.Accessible RoundPeriod m,
    Mod.Modifiable BestSequencedBlock m,
    HasVault m
  )

newtype BlockPeriod = BlockPeriod {unBlockPeriod :: NominalDiffTime}

newtype RoundPeriod = RoundPeriod {unRoundPeriod :: NominalDiffTime}

data SequencerConfig = SequencerConfig
  { dependentBlockDB :: DependentBlockDB,
    depBlockDBCacheSize :: Int,
    depBlockDBPath :: String,
    seenTransactionDBSize :: Int,
    blockstanbulBlockPeriod :: BlockPeriod,
    blockstanbulRoundPeriod :: RoundPeriod,
    blockstanbulTimeouts :: TMChan View,
    cablePackage :: CablePackage,
    maxEventsPerIter :: Int,
    maxUsPerIter :: Int,
    kafkaClientId :: ClientId,
    redisConn :: RBDB.RedisConnection
  }

type SequencerRow = '[StateCell SequencerContext, ReaderEnv SequencerConfig, IORef StreamEnv, InternalState, VaultData, Logger]

newtype SequencerM a = SequencerM {unSequencerM :: Eff SequencerRow a}
  deriving newtype (Functor, Applicative, Monad, MonadIO, MonadFail, MonadThrow, MonadCatch, MonadMask, MonadUnliftIO, MonadState SequencerContext, MonadReader SequencerConfig, MonadLogger, MonadLoggerIO, MonadResource, HasVault, AccessibleEnv (IORef StreamEnv), MonadMonitor)

instance Mod.Accessible DependentBlockDB SequencerM where
  access _ = asks dependentBlockDB

instance Mod.Accessible LDB.DB SequencerM where
  access _ = getDependentBlockDB <$> Mod.access (Mod.Proxy @DependentBlockDB)
{-
class HasNamespace a where
  type NSKey a


instance HasNamespace Checkpoint where
  type NSKey Checkpoint = ()
  namespace _ = "chkpt"
-}
instance Mod.Modifiable SeenTransactionDB SequencerM where
  get _ = use seenTransactionDB
  put _ = modify' . (.~) seenTransactionDB

instance Mod.Accessible (IORef (View, Maybe Block)) SequencerM where
  access _ = use latestViewAndProposal

instance Mod.Accessible (IORef (Maybe ViewTimer)) SequencerM where
  access _ = use armedViewTimer

instance Mod.Accessible (IORef (Maybe (AlarmClock UTCTime))) SequencerM where
  access _ = use roundTimerClock

instance Mod.Accessible (IORef (Maybe (View, UTCTime))) SequencerM where
  access _ = use armedRoundTimer

instance Mod.Accessible (TMChan View) SequencerM where
  access _ = asks blockstanbulTimeouts

instance Mod.Accessible BlockPeriod SequencerM where
  access _ = asks blockstanbulBlockPeriod

instance Mod.Accessible RoundPeriod SequencerM where
  access _ = asks blockstanbulRoundPeriod

instance Mod.Accessible View SequencerM where
  access _ = currentView

instance Mod.Accessible RBDB.RedisConnection SequencerM where
  access _ = asks redisConn

instance (Keccak256 `A.Alters` ()) SequencerM where
  lookup _ = genericLookupSeenTransactionDB
  insert _ = genericInsertSeenTransactionDB
  delete _ = genericDeleteSeenTransactionDB

instance HasBlockstanbulContext SequencerM where
  getBlockstanbulContext = use blockstanbulContext
  putBlockstanbulContext c = c `deepseq` modify' (blockstanbulContext .~ c)

instance Mod.Modifiable BestSequencedBlock SequencerM where
  get _ =
    use pendingBestSequencedBlock >>= \case
      Just v -> return v
      Nothing ->
        RBDB.withRedisBlockDB getBestSequencedBlockInfo <&> \case
          Nothing -> BestSequencedBlock (unsafeCreateKeccak256FromWord256 0) (-1) [] [] 0
          Just v -> v
  put _ = modify' . (pendingBestSequencedBlock ?~)

-- | Make the sequencer's record of what it has emitted durable: the
-- dependent-block DB and the best sequenced block in Redis. 'writeToKafka'
-- runs this right after each write of the output log and never without one,
-- so that record can never claim a block the log does not have.
commitSequencerState :: SequencerM ()
commitSequencerState = do
  commitDependentBlockDB
  use pendingBestSequencedBlock >>= mapM_ (\bsb ->
    RBDB.withRedisBlockDB (putBestSequencedBlockInfo bsb) >>= \case
      Left _ -> $logInfoS "commitSequencerState" $ T.pack "Failed to update BestSequencedBlock"
      Right _ -> pendingBestSequencedBlock .= Nothing)


runSequencerM :: String -> SequencerConfig -> BlockstanbulContext -> SequencerM a -> Eff '[Logger] a
runSequencerM vaultUrl' c bc m = do
  liftIO $ createDirectoryIfMissing False $ dbDir "h"
  runVaultM vaultUrl' . withResources . runStreamMConfigured (kafkaClientId c) $ do
    let dbCS = depBlockDBCacheSize c
        dbPath = depBlockDBPath c
        stxSize = seenTransactionDBSize c
    depBlock <- openDependentBlockDB dbPath dbCS
    latestVandP <- liftIO $ newIORef (View 0 0, Nothing)
    armedVT <- liftIO $ newIORef Nothing
    roundClock <- liftIO $ newIORef Nothing
    armedRT <- liftIO $ newIORef Nothing
    withReaderEnv c{dependentBlockDB = depBlock} $ evalStateEff
      SequencerContext
        { _seenTransactionDB = mkSeenTxDB stxSize,
          _blockstanbulContext = bc,
          _latestViewAndProposal = latestVandP,
          _armedViewTimer = armedVT,
          _roundTimerClock = roundClock,
          _armedRoundTimer = armedRT,
          _pendingBestSequencedBlock = Nothing
        }
      (unSequencerM m)

pairToVmTx :: (Timestamp, OutputTx) -> VmTask
pairToVmTx = uncurry VmTx

createFirstTimer ::
  ( MonadBlockstanbul m,
    Mod.Accessible View m
  ) =>
  m ()
createFirstTimer = do
  v <- Mod.access (Mod.Proxy @View)
  createNewTimer v

-- | Arm the round timer for the given view. It keeps re-firing every round
-- period until the global view has moved past it (a later round at the same
-- height, or a later height).
--
-- All arms share one AlarmClock. This used to allocate a fresh clock per
-- call, but blockstanbul asks for a timer reset at every new height --
-- including every historic block replayed during sync -- and each clock
-- parked a green thread for a full round period (an hour on real networks)
-- before it first fired and noticed it was stale. A from-genesis catch-up
-- at ~300 blocks/s held ~400,000 such threads at once: 4.5GB of STACK in a
-- heap census, all for timers on rounds that had finished long ago.
--
-- 'setAlarm' only ever moves a pending alarm earlier, so re-arming cannot
-- postpone the clock directly. Instead the intended (view, fire time) lives
-- in '_armedRoundTimer', and a wakeup before the stored fire time just puts
-- the clock back to sleep until then.
createNewTimer ::
  MonadBlockstanbul m =>
  View ->
  m ()
createNewTimer vw = do
  vref <- Mod.access (Mod.Proxy @(IORef (View, Maybe Block)))
  liftIO $ atomicModifyIORef' vref (\(cur, mb) -> ((max vw cur, mb), ()))
  ch <- Mod.access (Mod.Proxy @(TMChan View))
  dt <- unRoundPeriod <$> Mod.access (Mod.Proxy @(RoundPeriod))
  clockRef <- Mod.access (Mod.Proxy @(IORef (Maybe (AlarmClock UTCTime))))
  armedRef <- Mod.access (Mod.Proxy @(IORef (Maybe (View, UTCTime))))
  let act :: AlarmClock UTCTime -> IO ()
      act this' =
        readIORef armedRef >>= \case
          Nothing -> return ()
          Just (v, due) -> do
            now <- getCurrentTime
            if now < due
              then setAlarm this' due -- re-armed since this wakeup was scheduled
              else do
                atomically $ writeTMChan ch v
                globalView <- fst <$> readIORef vref
                -- The first RoundChange for this message may have not
                -- been seen, so we keep firing at the same interval
                -- until an alarm lands and the view changes
                unless (globalView > v) $ do
                  next <- addUTCTime dt <$> getCurrentTime
                  -- Yield to a concurrent re-arm: it already called 'setAlarm'.
                  rearmed <- atomicModifyIORef' armedRef $ \armed ->
                    if armed == Just (v, due)
                      then (Just (v, next), True)
                      else (armed, False)
                  when rearmed $ setAlarm this' next
  liftIO $ do
    due <- addUTCTime dt <$> getCurrentTime
    atomicModifyIORef' armedRef $ \_ -> (Just (vw, due), ())
    alarm <-
      readIORef clockRef >>= \case
        Just alarm -> return alarm
        Nothing -> do
          alarm <- newAlarmClock act
          atomicModifyIORef' clockRef $ \_ -> (Just alarm, ())
          return alarm
    setAlarm alarm due

-- | Arm the view timer for the current view. Called when a new transaction
-- arrives (there is now work the proposer should turn into a block), and when
-- the round changes while a timer was armed at the same height (that work is
-- still pending).
createNewViewTimer :: MonadBlockstanbul m => m ()
createNewViewTimer = do
  ctx <- getBlockstanbulContext
  let voting = case _selfAddr ctx of
        Just a -> _validatorBehavior ctx && Validator a `S.member` _validators ctx
        Nothing -> False
      leading = fmap Validator (_selfAddr ctx) == Just (_proposer ctx)
  -- This is the dead-proposer detector: it fires when no proposal has landed
  -- for the current view, so it belongs on the validators that are NOT
  -- proposing. A proposer has nothing to report to itself, and non-voting
  -- nodes (RPC followers with the default validatorBehavior=true) must not
  -- drive round changes at all.
  --
  -- It allows 'proposalWait' for the proposal to land. Once it lands, it
  -- allows as long again as the proposal took, plus 'commitSlack', for the
  -- block to commit (see 'updateViewTimer'); then it times the round out.
  when (voting && not leading) $ do
    updateViewTimer
    vpref <- Mod.access (Mod.Proxy @(IORef (View, Maybe Block)))
    (v, pCur) <- liftIO (readIORef vpref)
    armedRef <- Mod.access (Mod.Proxy @(IORef (Maybe ViewTimer)))
    ch <- Mod.access (Mod.Proxy @(TMChan View))
    -- At most one live clock per view. This used to allocate a fresh
    -- self-re-arming AlarmClock for every UnannouncedBlock, so a stalled
    -- chain accumulated one per candidate block -- hundreds of them, each
    -- firing every 5s and each emitting a ROUNDCHANGE.
    armed <- liftIO $ readIORef armedRef
    unless (fmap vtView armed == Just v) $ do
      let release =
            atomicModifyIORef' armedRef $ \cur ->
              (if fmap vtView cur == Just v then Nothing else cur, ())
          act :: AlarmClock UTCTime -> IO ()
          act this' = do
            v' <- fst <$> readIORef vpref
            readIORef armedRef >>= \case
              Just vt | vtView vt == v && v >= v' -> do
                now <- getCurrentTime
                if now < vtDue vt
                  then setAlarm this' (vtDue vt) -- pushed back since this wakeup was scheduled
                  else do
                    atomically . writeTMChan ch $ v'
                    let next = addUTCTime 5 now
                    atomicModifyIORef' armedRef $ \cur ->
                      (if fmap vtView cur == Just v then (\t -> t{vtDue = next}) <$> cur else cur, ())
                    setAlarm this' next
              -- Superseded by a later view: give up the slot so the next
              -- view can arm its own clock.
              _ -> release
      alarm <- liftIO $ newAlarmClock act
      now <- liftIO getCurrentTime
      -- A proposal that landed before our own candidate block took no time.
      let due = addUTCTime (if isJust pCur then commitSlack else proposalWait) now
      liftIO $ do
        atomicModifyIORef' armedRef $ \_ -> (Just (ViewTimer v now due alarm), ())
        setAlarm alarm due

-- | On entering a new view: a timer armed for an earlier round at the same
-- height means its transactions are still waiting for a block, so the new
-- round gets a timer too. A new height means they were committed.
carryViewTimer :: MonadBlockstanbul m => View -> m ()
carryViewTimer vw = do
  armedRef <- Mod.access (Mod.Proxy @(IORef (Maybe ViewTimer)))
  armed <- liftIO $ readIORef armedRef
  let pending vt = _sequence (vtView vt) == _sequence vw && _round (vtView vt) < _round vw
  when (maybe False pending armed) createNewViewTimer

-- | How long a non-proposer waits for the proposal before changing round.
proposalWait :: NominalDiffTime
proposalWait = 30

-- | Extra time, on top of the proposal's own latency, allowed for an accepted
-- proposal to commit before changing round.
commitSlack :: NominalDiffTime
commitSlack = 10

updateViewTimer :: MonadBlockstanbul m => m ()
updateViewTimer = do
  v <- currentView
  p <- _proposal <$> getBlockstanbulContext
  vpref <- Mod.access (Mod.Proxy @(IORef (View, Maybe Block)))
  (v0, p0) <- liftIO $ atomicModifyIORef' vpref (\old -> ((v, p), old))
  -- The proposal just landed: allow the time it took, plus 'commitSlack', for
  -- it to commit. 'setAlarm' only moves an alarm earlier; a later due time is
  -- picked up when the pending wakeup finds it has not arrived yet.
  when (isJust p && (isNothing p0 || v0 /= v)) $ do
    armedRef <- Mod.access (Mod.Proxy @(IORef (Maybe ViewTimer)))
    liftIO $ do
      now <- getCurrentTime
      rearm <- atomicModifyIORef' armedRef $ \case
        Just vt | vtView vt >= v ->
          let due = addUTCTime (commitSlack + max 0 (diffUTCTime now (vtArmedAt vt))) now
           in (Just vt{vtDue = due}, Just (vtClock vt, due))
        cur -> (cur, Nothing)
      mapM_ (uncurry setAlarm) rearm

fuseChannels :: (MonadIO m, MonadReader SequencerConfig m) =>
                m (ConduitM () SeqLoopEvent SequencerM ())
fuseChannels = do
  timers <- asks blockstanbulTimeouts
  let k = streamingConfig ethConf
      streamingAddress = (fromString $ streamingHost k, fromIntegral $ streamingPort k)

  let debugLog = (.| iterMC ($logDebugS "fuseChannels" . T.pack . format))
  debugLog
    <$> mergeSources
      [ conduitBatchSource "sequencer" streamingAddress unseqEventsTopicName .| mapC UnseqEvents,
        -- API transactions handed in through strato-ingest: its own durable
        -- subscriber, so a sequencer restart resumes where it stopped instead
        -- of skipping what arrived meanwhile (transactions dedup by hash, so
        -- the at-least-once redelivery is safe).
        conduitBatchSource "sequencer-ingest" streamingAddress ingestTxTopicName .| mapC UnseqEvents,
        sourceTMChan timers .| mapC TimerFire
      ]
      1 -- Keep decoded Kafka batches from piling up ahead of eventHandler.
