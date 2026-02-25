{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DefaultSignatures #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
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
    SequencerM,
    SequencerMTest,
    BlockPeriod (..),
    RoundPeriod (..),
    runSequencerM,
    runSequencerMTest,
    pairToVmTx,
    createFirstTimer,
    createNewTimer,
    createNewViewTimer,
    updateViewTimer,
    fuseChannels,
    seenTransactionDB,
    blockstanbulContext,
    latestViewAndProposal
  )
where

import BlockApps.Logging
import Blockchain.Blockstanbul
import Blockchain.Constants
import Blockchain.Model.SyncState
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader
import Blockchain.EthConf
import Blockchain.Model.WrappedBlock
import Blockchain.Sequencer.CablePackage
import Blockchain.Sequencer.DB.DependentBlockDB
import Blockchain.Sequencer.DB.SeenTransactionDB
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import Blockchain.SyncDB
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import qualified Blockchain.Strato.RedisBlockDB as RBDB
import ClassyPrelude (atomically)
import Conduit
import Control.Concurrent.AlarmClock
import Control.Concurrent.STM.TMChan
import Control.Lens
import Control.Monad (unless, when)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Kafka
import Control.Monad.Composable.Vault (VaultM, runVaultM)
import Control.Monad.Reader
import Control.Monad.State
import Data.Conduit.TMChan
import Data.IORef
import Data.Maybe
import Data.String
import qualified Data.Text as T
import Data.Time.Clock
import qualified Database.LevelDB as LDB
import System.Directory (createDirectoryIfMissing)
import Text.Format
import Prelude hiding (round)

data Modification a = Modification a | Deletion deriving (Show)

data SequencerContext = SequencerContext
  { _seenTransactionDB :: !SeenTransactionDB,
    _blockstanbulContext :: BlockstanbulContext,
    _latestViewAndProposal :: IORef (View, Maybe Block)
  }

makeLenses ''SequencerContext

type MonadBlockstanbul m =
  ( MonadIO m,
    HasBlockstanbulContext m,
    Mod.Accessible (IORef (View, Maybe Block)) m,
    Mod.Accessible (TMChan RoundNumber) m,
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
    blockstanbulTimeouts :: TMChan RoundNumber,
    cablePackage :: CablePackage,
    maxEventsPerIter :: Int,
    maxUsPerIter :: Int,
    kafkaClientId :: KafkaClientId,
    redisConn :: RBDB.RedisConnection
  }

type SequencerM = StateT SequencerContext (ReaderT SequencerConfig (KafkaM (ResourceT (VaultM (LoggingT IO)))))

-- Test version without VaultM - relies on external HasVault instance for the base monad
type SequencerMTest = StateT SequencerContext (ReaderT SequencerConfig (KafkaM (ResourceT (LoggingT IO))))

instance {-# OVERLAPPING #-} Monad m => Mod.Accessible DependentBlockDB (ReaderT SequencerConfig m) where
  access _ = asks dependentBlockDB

instance {-# OVERLAPPING #-} Monad m => Mod.Accessible LDB.DB (ReaderT SequencerConfig m) where
  access _ = getDependentBlockDB <$> Mod.access (Mod.Proxy @DependentBlockDB)
{-
class HasNamespace a where
  type NSKey a


instance HasNamespace Checkpoint where
  type NSKey Checkpoint = ()
  namespace _ = "chkpt"
-}
instance Monad m => Mod.Modifiable SeenTransactionDB (StateT SequencerContext m) where
  get _ = use seenTransactionDB
  put _ = modify' . (.~) seenTransactionDB

instance {-# OVERLAPPING #-} Monad m => Mod.Accessible (IORef (View, Maybe Block)) (StateT SequencerContext m) where
  access _ = use latestViewAndProposal

instance {-# OVERLAPPING #-} Monad m => Mod.Accessible (TMChan RoundNumber) (ReaderT SequencerConfig m) where
  access _ = asks blockstanbulTimeouts

instance {-# OVERLAPPING #-} Monad m => Mod.Accessible BlockPeriod (ReaderT SequencerConfig m) where
  access _ = asks blockstanbulBlockPeriod

instance {-# OVERLAPPING #-} Monad m => Mod.Accessible RoundPeriod (ReaderT SequencerConfig m) where
  access _ = asks blockstanbulRoundPeriod

instance {-# OVERLAPPING #-} Mod.Accessible View SequencerM where
  access _ = currentView

instance {-# OVERLAPPING #-} Monad m => Mod.Accessible RBDB.RedisConnection (ReaderT SequencerConfig m) where
  access _ = asks redisConn

instance Monad m => (Keccak256 `A.Alters` ()) (StateT SequencerContext m) where
  lookup _ = genericLookupSeenTransactionDB
  insert _ = genericInsertSeenTransactionDB
  delete _ = genericDeleteSeenTransactionDB

instance Monad m => HasBlockstanbulContext (StateT SequencerContext m) where
  getBlockstanbulContext = use blockstanbulContext
  putBlockstanbulContext = modify' . (.~) blockstanbulContext

instance (MonadIO m, MonadLogger m) => Mod.Modifiable BestSequencedBlock (ReaderT SequencerConfig m) where
  get _ =
    RBDB.withRedisBlockDB getBestSequencedBlockInfo <&> \case
      Nothing -> BestSequencedBlock (unsafeCreateKeccak256FromWord256 0) (-1) []
      Just v -> v
  put _ bestSequencedBlock =
    RBDB.withRedisBlockDB (putBestSequencedBlockInfo bestSequencedBlock) >>= \case
      Left _ -> $logInfoS "ContextM.put BestSequencedBlock" $ T.pack "Failed to update BestSequencedBlock"
      Right _ -> return ()

instance (MonadIO m, MonadLogger m, Mod.Modifiable BestSequencedBlock m) => Mod.Modifiable BestSequencedBlock (StateT SequencerContext m) where
  get   = lift . Mod.get
  put p = lift . Mod.put p


runSequencerM :: String -> SequencerConfig -> BlockstanbulContext -> SequencerM a -> (LoggingT IO) a
runSequencerM vaultUrl' c bc m = do
  liftIO $ createDirectoryIfMissing False $ dbDir "h"
  a <- runVaultM vaultUrl' . runResourceT . runKafkaMConfigured (kafkaClientId c) $ do
    let dbCS = depBlockDBCacheSize c
        dbPath = depBlockDBPath c
        stxSize = seenTransactionDBSize c
    depBlock <- DependentBlockDB <$> LDB.open dbPath LDB.defaultOptions {LDB.createIfMissing = True, LDB.cacheSize = dbCS}
    latestVandP <- liftIO $ newIORef (View 0 0, Nothing)
    flip runReaderT c{dependentBlockDB = depBlock} $ runStateT m
      SequencerContext
        { _seenTransactionDB = mkSeenTxDB stxSize,
          _blockstanbulContext = bc,
          _latestViewAndProposal = latestVandP
        }
  return $ fst a

-- Test version without VaultM - relies on external HasVault instance
runSequencerMTest :: SequencerConfig -> BlockstanbulContext -> SequencerMTest a -> (LoggingT IO) a
runSequencerMTest c bc m = do
  liftIO $ createDirectoryIfMissing False $ dbDir "h"
  a <- runResourceT . runKafkaMConfigured (kafkaClientId c) $ do
    let dbCS = depBlockDBCacheSize c
        dbPath = depBlockDBPath c
        stxSize = seenTransactionDBSize c
    depBlock <- DependentBlockDB <$> LDB.open dbPath LDB.defaultOptions {LDB.createIfMissing = True, LDB.cacheSize = dbCS}
    latestVandP <- liftIO $ newIORef (View 0 0, Nothing)
    flip runReaderT c{dependentBlockDB = depBlock} $ runStateT m
      SequencerContext
        { _seenTransactionDB = mkSeenTxDB stxSize,
          _blockstanbulContext = bc,
          _latestViewAndProposal = latestVandP
        }
  return $ fst a

pairToVmTx :: (Timestamp, OutputTx) -> VmEvent
pairToVmTx = uncurry VmTx

createFirstTimer ::
  ( MonadBlockstanbul m,
    Mod.Accessible View m
  ) =>
  m ()
createFirstTimer = do
  v <- Mod.access (Mod.Proxy @View)
  createNewTimer . _round $ v

createNewTimer ::
  MonadBlockstanbul m =>
  RoundNumber ->
  m ()
createNewTimer rn = do
  rnref <- Mod.access (Mod.Proxy @(IORef (View, Maybe Block)))
  liftIO $ atomicModifyIORef' rnref (\(View r s, mb) -> ((View (max rn r) s, mb), ()))
  ch <- Mod.access (Mod.Proxy @(TMChan RoundNumber))
  dt <- unRoundPeriod <$> Mod.access (Mod.Proxy @(RoundPeriod))
  let act :: AlarmClock UTCTime -> IO ()
      act this' = do
        atomically $ writeTMChan ch rn
        globalRN <- readIORef rnref
        -- The first RoundChange for this message may have not
        -- been seen, so we keep firing at the same interval
        -- until an alarm lands and the round changes
        unless (_round (fst globalRN) > rn) $ do
          next <- addUTCTime dt <$> getCurrentTime
          setAlarm this' next
  alarm <- liftIO $ newAlarmClock act
  next <- addUTCTime dt <$> liftIO getCurrentTime
  liftIO $ setAlarm alarm next

createNewViewTimer :: MonadBlockstanbul m => Block -> m ()
createNewViewTimer b = do
  updateViewTimer
  vpref <- Mod.access (Mod.Proxy @(IORef (View, Maybe Block)))
  vCur <- fst <$> liftIO (readIORef vpref)
  let v = vCur{ _sequence = max 1 $ fromIntegral (number $ blockBlockData b) - 1 }
  ch <- Mod.access (Mod.Proxy @(TMChan RoundNumber))
  let act :: AlarmClock UTCTime -> IO ()
      act this' = do
        (v', p) <- readIORef vpref
        when (v >= v' && isNothing p) $ do
          atomically . writeTMChan ch $ _round v'
          next <- addUTCTime 5 <$> getCurrentTime
          setAlarm this' next
  alarm <- liftIO $ newAlarmClock act
  next <- addUTCTime 2 <$> liftIO getCurrentTime
  liftIO $ setAlarm alarm next

updateViewTimer :: MonadBlockstanbul m => m ()
updateViewTimer = do
  v <- currentView
  p <- _proposal <$> getBlockstanbulContext
  vpref <- Mod.access (Mod.Proxy @(IORef (View, Maybe Block)))
  liftIO $ atomicModifyIORef' vpref (\_ -> ((v, p), ()))

fuseChannels :: (MonadIO m, MonadReader SequencerConfig m) =>
                m (ConduitM () SeqLoopEvent SequencerM ())
fuseChannels = do
  timers <- asks blockstanbulTimeouts
  let k = kafkaConfig ethConf
      kafkaAddress = (fromString $ kafkaHost k, fromIntegral $ kafkaPort k)

  let debugLog = (.| iterMC ($logDebugS "fuseChannels" . T.pack . format))
  (debugLog . transPipe lift)
    <$> mergeSources
      [ conduitBatchSource "sequencer" kafkaAddress unseqEventsTopicName .| mapC UnseqEvents,
        sourceTMChan timers .| mapC TimerFire
      ]
      4096 -- 🙏
