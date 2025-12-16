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
    BlockPeriod (..),
    RoundPeriod (..),
    runSequencerM,
    pairToVmTx,
    createFirstTimer,
    createNewTimer,
    fuseChannels,
    seenTransactionDB,
    blockstanbulContext,
    latestRoundNumber
  )
where

import BlockApps.Logging
import Blockchain.Blockstanbul
import Blockchain.Constants
import Blockchain.Model.SyncState
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
import Control.Concurrent (threadDelay)
import Control.Concurrent.AlarmClock
import Control.Concurrent.STM.TMChan
import Control.Lens
import Control.Monad (unless)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Kafka
import Control.Monad.Reader
import Control.Monad.State
import qualified Data.ByteString.Char8 as C8
import Data.Conduit.TMChan
import Data.IORef
import Data.Maybe
import Data.String
import qualified Data.Text as T
import Data.Time.Clock
import qualified Database.LevelDB as LDB
import qualified LabeledError
import Servant.Client
import qualified Strato.Strato23.API.Types as VC hiding (Address (..))
import qualified Strato.Strato23.Client as VC
import System.Directory (createDirectoryIfMissing)
import Text.Format
import Prelude hiding (round)

data Modification a = Modification a | Deletion deriving (Show)

data SequencerContext = SequencerContext
  { _seenTransactionDB :: !SeenTransactionDB,
    _blockstanbulContext :: BlockstanbulContext,
    _latestRoundNumber :: IORef RoundNumber
  }

makeLenses ''SequencerContext

type MonadBlockstanbul m =
  ( MonadIO m,
    HasBlockstanbulContext m,
    Mod.Accessible (IORef RoundNumber) m,
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
    vaultClient :: Maybe ClientEnv, -- Nothing in tests
    kafkaClientId :: KafkaClientId,
    redisConn :: RBDB.RedisConnection
  }

type SequencerM = StateT SequencerContext (ReaderT SequencerConfig (KafkaM (ResourceT (LoggingT IO))))

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

instance {-# OVERLAPPING #-} Monad m => Mod.Accessible (IORef RoundNumber) (StateT SequencerContext m) where
  access _ = use latestRoundNumber

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

-- If there is no vault client (i.e. in hspec tests), the HasVault instance will use this key,
-- I know, it's ugly...the SequencerSpec test uses SequencerM itself, so this was a lot
-- easier than making a whole new SequencerM definition just to get a different HasVault instance
testPriv :: PrivateKey
testPriv = fromMaybe (error "could not import private key") (importPrivateKey (LabeledError.b16Decode "testPriv" $ C8.pack $ "09e910621c2e988e9f7f6ffcd7024f54ec1461fa6e86a4b545e9e1fe21c28866"))

instance (MonadIO m, MonadLogger m) => HasVault (ReaderT SequencerConfig m) where
  sign mesg = do
    mVc <- asks vaultClient
    case mVc of
      Nothing -> return $ signMsg testPriv mesg
      Just vc -> waitOnVault $ liftIO $ runClientM (VC.postSignature Nothing (VC.MsgHash mesg)) vc

  getPub = error "called getPub in SequencerM, but this should never happen"
  getShared _ = error "called getShared in SequencerM, but this should never happen"

instance (MonadIO m, HasVault m) => HasVault (StateT SequencerContext m) where
  sign      = lift . sign
  getPub    = lift getPub
  getShared = lift . getShared

waitOnVault :: (Show a, MonadIO m, MonadLogger m) => m (Either a b) -> m b
waitOnVault action = do
  $logInfoS "HasVault" "Asking the vault-proxy to sign a Blockstanbul message"
  res <- action
  case res of
    Left err -> do
      $logErrorS "HasVault" . T.pack $ "failed to get signature from vault...got: " ++ (show err)
      liftIO $ threadDelay 2000000 -- 2 seconds
      waitOnVault action
    Right val -> do
      $logInfoS "HasVault" "Got a signature from vault"
      return val

runSequencerM :: SequencerConfig -> BlockstanbulContext -> SequencerM a -> (LoggingT IO) a
runSequencerM c bc m = do
  liftIO $ createDirectoryIfMissing False $ dbDir "h"
  a <- runResourceT . runKafkaMConfigured (kafkaClientId c) $ do
    let dbCS = depBlockDBCacheSize c
        dbPath = depBlockDBPath c
        stxSize = seenTransactionDBSize c
    depBlock <- DependentBlockDB <$> LDB.open dbPath LDB.defaultOptions {LDB.createIfMissing = True, LDB.cacheSize = dbCS}
    latestRound <- liftIO $ newIORef 0
    flip runReaderT c{dependentBlockDB = depBlock} $ runStateT m
      SequencerContext
        { _seenTransactionDB = mkSeenTxDB stxSize,
          _blockstanbulContext = bc,
          _latestRoundNumber = latestRound
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
  rnref <- Mod.access (Mod.Proxy @(IORef RoundNumber))
  liftIO $ atomicModifyIORef' rnref (\x -> (max rn x, ()))
  ch <- Mod.access (Mod.Proxy @(TMChan RoundNumber))
  dt <- unRoundPeriod <$> Mod.access (Mod.Proxy @(RoundPeriod))
  let act :: AlarmClock UTCTime -> IO ()
      act this' = do
        atomically $ writeTMChan ch rn
        globalRN <- readIORef rnref
        -- The first RoundChange for this message may have not
        -- been seen, so we keep firing at the same interval
        -- until an alarm lands and the round changes
        unless (globalRN > rn) $ do
          next <- addUTCTime dt <$> getCurrentTime
          setAlarm this' next
  alarm <- liftIO $ newAlarmClock act
  next <- addUTCTime dt <$> liftIO getCurrentTime
  liftIO $ setAlarm alarm next

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
