{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DefaultSignatures #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RankNTypes #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Sequencer.Monad
  ( MonadBlockstanbul,
    SequencerContext (..),
    SequencerConfig (..),
    SequencerM,
    BlockPeriod (..),
    RoundPeriod (..),
    runSequencerM,
    pairToVmTx,
    clearLdbBatchOps,
    flushLdbBatchOps,
    clearDBERegistry,
    createFirstTimer,
    createNewTimer,
    fuseChannels,
    loopTimeout,
  )
where

import BlockApps.Logging
import BlockApps.X509.Certificate
import Blockchain.Blockstanbul
import Blockchain.Constants
import Blockchain.Data.Block
import Blockchain.EthConf
import Blockchain.Sequencer.CablePackage
import Blockchain.Sequencer.DB.DependentBlockDB
import Blockchain.Sequencer.DB.GetTransactionsDB
import Blockchain.Sequencer.DB.SeenTransactionDB
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import Blockchain.Sequencer.Metrics
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import qualified Blockchain.Strato.RedisBlockDB as RBDB
import qualified Blockchain.Strato.RedisBlockDB.Models as RBDB
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
import Data.Binary
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as C8
import qualified Data.ByteString.Lazy as BL
import Data.Conduit.TMChan
import Data.Foldable (foldl', toList)
import Data.IORef
import Data.Map (Map)
import qualified Data.Map as M
import Data.Maybe
import qualified Data.Sequence as Q
import Data.String
import qualified Data.Text as T
import Data.Time.Clock
import qualified Database.LevelDB as LDB
import qualified LabeledError
import Prometheus
import Servant.Client
import qualified Strato.Strato23.API.Types as VC hiding (Address (..))
import qualified Strato.Strato23.Client as VC
import System.Directory (createDirectoryIfMissing)
import Text.Format
import Prelude hiding (round)

data Modification a = Modification a | Deletion deriving (Show)

data SequencerContext = SequencerContext
  { _dependentBlockDB :: DependentBlockDB,
    _seenTransactionDB :: !SeenTransactionDB,
    _dbeRegistry :: !(Map Keccak256 DependentBlockEntry),
    _x509certInfoState :: !(Map Address (Modification X509CertInfoState)), --map to pubkey
    _getTransactionsDB :: !GetTransactionsDB,
    _ldbBatchOps :: !(Q.Seq LDB.BatchOp),
    _blockstanbulContext :: Maybe BlockstanbulContext,
    _loopTimeout :: TMChan (),
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
    (Address `A.Alters` X509CertInfoState) m,
    (Address `A.Selectable` X509CertInfoState) m,
    HasVault m
  )

newtype BlockPeriod = BlockPeriod {unBlockPeriod :: NominalDiffTime}

newtype RoundPeriod = RoundPeriod {unRoundPeriod :: NominalDiffTime}

data SequencerConfig = SequencerConfig
  { depBlockDBCacheSize :: Int,
    depBlockDBPath :: String,
    seenTransactionDBSize :: Int,
    syncWrites :: Bool,
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

instance HasDependentBlockDB SequencerM where
  getDependentBlockDB = use dependentBlockDB
  getWriteOptions = LDB.WriteOptions . syncWrites <$> ask
  getReadOptions = return LDB.defaultReadOptions

instance Mod.Modifiable GetTransactionsDB SequencerM where
  get _ = use getTransactionsDB
  put _ g = modify' $ getTransactionsDB .~ g

instance Mod.Accessible LDB.DB SequencerM where
  access _ = use dependentBlockDB

class HasNamespace a where
  type NSKey a
  namespace :: Mod.Proxy a -> BL.ByteString

  namespaced :: Mod.Proxy a -> NSKey a -> B.ByteString
  default namespaced :: Binary (NSKey a) => Mod.Proxy a -> NSKey a -> B.ByteString
  namespaced p = BL.toStrict . BL.append (namespace p) . encode

instance HasNamespace X509CertInfoState where
  type NSKey X509CertInfoState = Address
  namespace _ = "cis:" -- make a namespace instance for new mapping

instance HasNamespace Checkpoint where
  type NSKey Checkpoint = ()
  namespace _ = "chkpt"

lookupInLDB ::
  (Binary a, HasNamespace a, MonadIO m, Mod.Accessible LDB.DB m) =>
  Mod.Proxy a ->
  NSKey a ->
  m (Maybe a)
lookupInLDB p k =
  Mod.access Mod.Proxy >>= \db ->
    fmap (decode . BL.fromStrict) <$> LDB.get db LDB.defaultReadOptions (namespaced p k)

batchInsertInLDB :: (Binary a, HasNamespace a) => Mod.Proxy a -> NSKey a -> a -> LDB.BatchOp
batchInsertInLDB p k v = LDB.Put (namespaced p k) (BL.toStrict $ encode v)

batchDeleteInLDB ::
  HasNamespace a =>
  Mod.Proxy a ->
  NSKey a ->
  LDB.BatchOp
batchDeleteInLDB p k = LDB.Del (namespaced p k)

genericLookupSequencer ::
  (Ord (NSKey a), Binary a, HasNamespace a) =>
  Lens' SequencerContext (Map (NSKey a) (Modification a)) ->
  Mod.Proxy a ->
  NSKey a ->
  SequencerM (Maybe a)
genericLookupSequencer registry p k =
  use (registry . at k) >>= \case
    Just Deletion -> return Nothing
    Just (Modification a) -> return $ Just a
    Nothing ->
      lookupInLDB p k >>= \case
        Nothing -> return Nothing
        Just a -> do
          registry . at k ?= Modification a
          return $ Just a

genericInsertSequencer ::
  (Ord (NSKey a), Binary a, HasNamespace a) =>
  Lens' SequencerContext (Map (NSKey a) (Modification a)) ->
  Mod.Proxy a ->
  NSKey a ->
  a ->
  SequencerM ()
genericInsertSequencer registry p k a = do
  modify' $ registry . at k ?~ Modification a
  addLdbBatchOps . (: []) $ batchInsertInLDB p k a

genericDeleteSequencer ::
  (Ord (NSKey a), HasNamespace a) =>
  Lens' SequencerContext (Map (NSKey a) (Modification a)) ->
  Mod.Proxy a ->
  NSKey a ->
  SequencerM ()
genericDeleteSequencer registry p k = do
  modify' $ registry . at k ?~ Deletion
  addLdbBatchOps . (: []) $ batchDeleteInLDB p k

instance (Address `A.Alters` X509CertInfoState) SequencerM where
  lookup = genericLookupSequencer x509certInfoState
  insert p k v = do
    genericInsertSequencer x509certInfoState p k v
    sz <- M.size <$> use x509certInfoState
    liftIO $ withLabel x509CertInfoStateRegistrySize "X509CertInfoState_registry" (flip setGauge (fromIntegral sz))
  delete p k = do
    genericDeleteSequencer x509certInfoState p k
    sz <- M.size <$> use x509certInfoState
    liftIO $ withLabel x509CertInfoStateRegistrySize "X509CertInfoState_registry" (flip setGauge (fromIntegral sz))

instance A.Selectable Address X509CertInfoState SequencerM where
  select = A.lookup

instance (Keccak256 `A.Alters` DependentBlockEntry) SequencerM where
  lookup _ k = do
    mv <- use $ dbeRegistry . at k
    case mv of
      Just v -> return $ Just v
      Nothing -> genericLookupDependentBlockDB k
  insert _ k v = do
    modify' $ dbeRegistry . at k ?~ v
    addLdbBatchOps . (: []) $ genericBatchInsertDependentBlockDB k v
  delete _ k = do
    modify' $ dbeRegistry . at k .~ Nothing
    addLdbBatchOps . (: []) $ genericBatchDeleteDependentBlockDB k

instance Mod.Modifiable SeenTransactionDB SequencerM where
  get _ = use seenTransactionDB
  put _ = modify' . (.~) seenTransactionDB

instance Mod.Modifiable (Q.Seq LDB.BatchOp) SequencerM where
  get _ = use ldbBatchOps
  put _ = modify' . (.~) ldbBatchOps

instance Mod.Accessible (IORef RoundNumber) SequencerM where
  access _ = use latestRoundNumber

instance Mod.Accessible (TMChan RoundNumber) SequencerM where
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
  putBlockstanbulContext = modify' . (.~) (blockstanbulContext . _Just)

instance Mod.Modifiable BestSequencedBlock SequencerM where
  get _ =
    RBDB.withRedisBlockDB RBDB.getBestSequencedBlockInfo <&> \case
      Nothing -> BestSequencedBlock $ BestBlock (unsafeCreateKeccak256FromWord256 0) (-1)
      Just (RBDB.RedisBestBlock s n) -> BestSequencedBlock $ BestBlock s n
  put _ (BestSequencedBlock (BestBlock s n)) =
    RBDB.withRedisBlockDB (RBDB.putBestSequencedBlockInfo s n) >>= \case
      Left _ -> $logInfoS "ContextM.put BestSequencedBlock" $ T.pack "Failed to update BestSequencedBlock"
      Right _ -> return ()

instance (() `A.Alters` Checkpoint) SequencerM where
  lookup = lookupInLDB
  insert p k v = addLdbBatchOps . (: []) $ batchInsertInLDB p k v
  delete p k = addLdbBatchOps . (: []) $ batchDeleteInLDB p k

-- If there is no vault client (i.e. in hspec tests), the HasVault instance will use this key,
-- I know, it's ugly...the SequencerSpec test uses SequencerM itself, so this was a lot
-- easier than making a whole new SequencerM definition just to get a different HasVault instance
testPriv :: PrivateKey
testPriv = fromMaybe (error "could not import private key") (importPrivateKey (LabeledError.b16Decode "testPriv" $ C8.pack $ "09e910621c2e988e9f7f6ffcd7024f54ec1461fa6e86a4b545e9e1fe21c28866"))

instance HasVault SequencerM where
  sign mesg = do
    mVc <- asks vaultClient
    case mVc of
      Nothing -> return $ signMsg testPriv mesg
      Just vc -> waitOnVault $ liftIO $ runClientM (VC.postSignature Nothing (VC.MsgHash mesg)) vc

  getPub = error "called getPub in SequencerM, but this should never happen"
  getShared _ = error "called getShared in SequencerM, but this should never happen"

waitOnVault :: (Show a) => SequencerM (Either a b) -> SequencerM b
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

runSequencerM :: SequencerConfig -> Maybe BlockstanbulContext -> SequencerM a -> (LoggingT IO) a
runSequencerM c mbc m = do
  liftIO $ createDirectoryIfMissing False $ dbDir "h"
  a <- runResourceT . runKafkaMConfigured (kafkaClientId c) . flip runReaderT c $ do
    dbCS <- asks depBlockDBCacheSize
    dbPath <- asks depBlockDBPath
    stxSize <- asks seenTransactionDBSize
    depBlock <- LDB.open dbPath LDB.defaultOptions {LDB.createIfMissing = True, LDB.cacheSize = dbCS}
    loopCh <- atomically newTMChan
    latestRound <- liftIO $ newIORef 0
    runStateT
      m
      SequencerContext
        { _dependentBlockDB = depBlock,
          _seenTransactionDB = mkSeenTxDB stxSize,
          _dbeRegistry = M.empty,
          _x509certInfoState = M.empty,
          _getTransactionsDB = emptyGetTransactionsDB,
          _ldbBatchOps = Q.empty,
          _blockstanbulContext = mbc,
          _loopTimeout = loopCh,
          _latestRoundNumber = latestRound
        }

  return $ fst a

pairToVmTx :: (Timestamp, OutputTx) -> VmEvent
pairToVmTx = uncurry VmTx

clearDBERegistry :: MonadState SequencerContext m => m ()
clearDBERegistry = modify' $ dbeRegistry .~ M.empty

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

clearLdbBatchOps :: Mod.Modifiable (Q.Seq LDB.BatchOp) m => m ()
clearLdbBatchOps = Mod.put (Mod.Proxy @(Q.Seq LDB.BatchOp)) Q.empty

flushLdbBatchOps :: (MonadMonitor m, HasDependentBlockDB m, Mod.Modifiable (Q.Seq LDB.BatchOp) m, MonadState SequencerContext m) => m ()
flushLdbBatchOps = do
  pendingLDBWrites <- use ldbBatchOps
  applyLDBBatchWrites $ toList pendingLDBWrites
  incCounter seqLdbBatchWrites
  setGauge seqLdbBatchSize . fromIntegral $ length pendingLDBWrites
  $logInfoS "flushLdbBatchOps" "Applied pending LDB writes"
  clearLdbBatchOps

addLdbBatchOps :: Mod.Modifiable (Q.Seq LDB.BatchOp) m => [LDB.BatchOp] -> m ()
addLdbBatchOps ops = Mod.modify_ (Mod.Proxy @(Q.Seq LDB.BatchOp)) $ \existingOps ->
  pure $ foldl' (Q.|>) existingOps ops

fuseChannels :: (MonadIO m, MonadReader SequencerConfig m) =>
                m (ConduitM () SeqLoopEvent SequencerM ())
fuseChannels = do
  timers <- asks blockstanbulTimeouts
  let k = kafkaConfig ethConf
      kafkaAddress = (fromString $ kafkaHost k, fromIntegral $ kafkaPort k)

  let debugLog = (.| iterMC ($logDebugS "fuseChannels" . T.pack . format))
  (debugLog . transPipe lift)
    <$> mergeSources
      [ conduitBatchSource "conduitSource" "sequencer" kafkaAddress unseqEventsTopicName .| mapC UnseqEvents,
        sourceTMChan timers .| mapC TimerFire
      ]
      4096 -- 🙏
