{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS -fno-warn-orphans      #-}
{-# OPTIONS_GHC -Wno-deriving-defaults #-}

module Blockchain.VMContext
  ( CurrentBlockHash (..),
    withCurrentBlockHash,
    withCurrentBlockHashNoCommit,
    VMBase,
    ContextDBs (..),
    MemContextDBs (..),
    Backend (..),
    MemDBs (..),
    ContextState (..),
    QueueEvent (..),
    Context (..),
    ContextBestBlockInfo (..),
    ContextM (..),
    ContextRow,
    runContextIO,
    GasCap (..),
    stateDB,
    hashDB,
    codeDB,
    blockSummaryDB,
    redisPool,
    sqldb,
    memHashDB,
    memCodeDB,
    memBlockSummaryDB,
    stateTxMap,
    stateBlockMap,
    storageBlockMap,
    stateRoots,
    currentBlock,
    flushedRoot,
    memDBs,
    baggerState,
    bestBlockInfo,
    vmGasCap,
    selfAddress,
    runningTests,
    txRunResultsCache,
    debugSettings,
    vmTracer,
    backend,
    state,
    stateDiffQueue,
    resolveFile,
    fetchMissingNodes,
    runTestContextM,
    initContext,
    initContextWithLevelDBTuning,
    initReplayContext,
    runContextM,
    evalContextM,
    execContextM,
    runMemContextM,
    evalMemContextM,
    evalSandboxedContextM,
    withFetchMissingNodes,
    incrementNonce,
    getNewAddress,
    getNewAddressWithSalt,
    purgeStorageMap,
    getContextBestBlockInfo,
    putContextBestBlockInfo,
    checkIfRunningTests,
    knownFailedTxs,
    knownExpensiveTxs,
  )
where

import BlockApps.Init ()
import BlockApps.Logging
import Blockchain.Bagger.BaggerState (BaggerState, defaultBaggerState)
import Blockchain.Constants
import Blockchain.DB.BlockSummaryDB
import Blockchain.DB.CodeDB
import Blockchain.DB.HashDB
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.RawStorageDB
import Blockchain.DB.SQLDB
import Blockchain.DB.StateDB
import Blockchain.DB.StorageDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.BlockHeader
import Blockchain.Data.BlockSummary
import Blockchain.Data.DataDefs
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.EthConf
import qualified Blockchain.EthConf.Model as Conf
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.CodePtr ()
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Gas
import Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Strato.RedisBlockDB as RBDB
import Blockchain.Strato.StateDiff (StateDiff)
import qualified Blockchain.TxRunResultCache as TRC
import Blockchain.VM.SolidException
import Blockchain.VMOptions
import Control.DeepSeq
import Control.Lens hiding (Context (..))
import Control.Monad (when)
import Control.Monad.Catch (MonadCatch, MonadThrow)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Catch (MonadMask)
import Control.Monad.Composable.Base
import Control.Monad.Composable.NodeDB
import Control.Monad.Composable.Streaming (StreamEnv (..), StreamM, createStreamEnv, runStreamMUsingEnv)
import Control.Monad.IO.Class
import Prometheus (MonadMonitor)
import Data.Binary
import Data.Default
import qualified Data.HashSet as HS
import qualified Data.Map as M
import qualified Data.NibbleString as N
import qualified Data.Set as S
import qualified Data.Text as T
import qualified Database.LevelDB.Base as DB
import qualified Database.Persist.Sqlite as Lite
import qualified Database.Redis as Redis
import Blockchain.Data.VmTrace (VmTracer)
import Debugger
import GHC.Generics
import SolidVM.Model.Storable
import SolidVM.Model.Value
import System.Directory
import Text.Format
import UnliftIO

{-# NOINLINE knownFailedTxs #-}
knownFailedTxs :: S.Set Keccak256
knownFailedTxs =
  S.fromList
    [
    ]

{-# NOINLINE knownExpensiveTxs #-}
knownExpensiveTxs :: S.Set Keccak256
knownExpensiveTxs =
  S.fromList
    [
    ]

newtype CurrentBlockHash = CurrentBlockHash {unCurrentBlockHash :: Keccak256}
  deriving (Generic, NFData, Show)

newtype GasCap = GasCap {unVmGasCap :: Gas}
  deriving (Generic, NFData, Show, Eq)

instance NFData RBDB.RedisConnection where
  rnf (RBDB.RedisConnection c) = c `seq` ()

data ContextBestBlockInfo = Unspecified | ContextBestBlockInfo !Keccak256 !BlockHeader !Int
  deriving (Eq, Show, Generic, NFData)

instance Binary ContextBestBlockInfo

data ContextDBs = ContextDBs
  { _stateDB :: MP.StateDB,
    _hashDB :: HashDB,
    _codeDB :: CodeDB,
    _blockSummaryDB :: BlockSummaryDB,
    _redisPool :: RBDB.RedisConnection,
    _sqldb :: SQLDB
  }
  deriving (Generic, NFData)

makeLenses ''ContextDBs

-- | Map-backed versions of the persistent stores other than trie nodes.
data MemContextDBs = MemContextDBs
  { _memHashDB :: M.Map N.NibbleString N.NibbleString,
    _memCodeDB :: M.Map Keccak256 DBCode,
    _memBlockSummaryDB :: M.Map Keccak256 BlockSummary
  }
  deriving (Generic)

makeLenses ''MemContextDBs

instance Default MemContextDBs where
  def = MemContextDBs M.empty M.empty M.empty

-- | Where the stores live. 'Sandbox' reads through to the persistent stores
-- on a miss and keeps every write in the overlay (eth_call, tracing).
data Backend
  = Persistent ContextDBs
  | Memory (IORef MemContextDBs)
  | Sandbox (IORef MemContextDBs) ContextDBs

data MemDBs = MemDBs
  { -- Accounts modified by the current transaction (for its TransactionResult only).
    _stateTxMap :: !(M.Map Address AddressStateModification),
    _stateBlockMap :: !(BlockMap Address AddressStateModification),
    _storageBlockMap :: !(BlockMap (Address, StoragePath) BasicValue),
    _stateRoots :: !(M.Map (Keccak256, Maybe Word256) MP.StateRoot),
    _currentBlock :: !(Maybe CurrentBlockHash),
    -- State root the block-map entries retained past the last flush are valid for.
    _flushedRoot :: !(Maybe MP.StateRoot)
  }
  deriving (Generic, NFData, Show)

makeLenses ''MemDBs

instance Default MemDBs where
  def =
    MemDBs
      { _stateTxMap = M.empty,
        _stateBlockMap = emptyBlockMap,
        _storageBlockMap = emptyBlockMap,
        _stateRoots = M.empty,
        _currentBlock = Nothing,
        _flushedRoot = Nothing
      }

data ContextState = ContextState
  { _memDBs :: !MemDBs,
    _baggerState :: !BaggerState,
    _bestBlockInfo :: !ContextBestBlockInfo,
    _vmGasCap :: !Gas,
    _runningTests :: !Bool,
    _txRunResultsCache :: TRC.Cache,
    _debugSettings :: !(Maybe DebugSettings),
    _vmTracer :: !(Maybe VmTracer),
    _selfAddress :: !Address
  }
  deriving (Generic, NFData)

makeLenses ''ContextState

instance Default ContextState where
  def =
    ContextState
      { _memDBs = def,
        _baggerState = defaultBaggerState,
        _bestBlockInfo = Unspecified,
        _vmGasCap = Gas (Conf.gasLimit $ networkConfig ethConf),
        _runningTests = False,
        _txRunResultsCache = error "Default ContextState: accessing uninitialized txRunResultsCache",
        _debugSettings = Nothing,
        _vmTracer = Nothing,
        _selfAddress = Address 0
      }

data QueueEvent
  = TXR TransactionResult
  | SD StateDiff
  | Flush

data Context = Context
  { _backend :: Backend,
    _state :: IORef ContextState,
    _stateDiffQueue :: TQueue QueueEvent,
    -- | Source lookup for @import@ resolution; the node has none, the CLI reads files.
    _resolveFile :: FilePath -> IO (Maybe (Either String String)),
    -- | Ask peers for Merkle-Patricia nodes missing locally (state-root mismatch diagnostics).
    _fetchMissingNodes :: Bool
  }

makeLenses ''Context

-- | The node's monad: the 'Context' record of 'IORef's and handles composed
-- with the node store, streaming and logging monads, as one flat @Env -> IO@ layer.
type ContextRow = '[Context, NodeDB, IORef StreamEnv, Logger]

newtype ContextM a = ContextM {unContextM :: Eff ContextRow a}
  deriving newtype (Functor, Applicative, Monad, MonadIO, MonadFail, MonadThrow, MonadCatch, MonadMask, MonadUnliftIO, MonadLogger, MonadLoggerIO, AccessibleEnv Context, AccessibleEnv NodeDB, AccessibleEnv (IORef StreamEnv), MonadMonitor)

runContextIO :: Context -> ContextM a -> StreamM '[Logger] a
runContextIO ctx (ContextM m) = nodeDBFor (_backend ctx) >>= \db -> runNodeDBM db (provide ctx m)

-- | Trie nodes live in LevelDB when there is one, otherwise in a map for the run.
nodeDBFor :: MonadIO m => Backend -> m NodeDB
nodeDBFor (Memory _) = mapNodeDB <$> liftIO (newIORef M.empty)
nodeDBFor (Persistent d) = pure $ levelDBNodeDB (MP.unStateDB $ _stateDB d)
nodeDBFor (Sandbox _ d) = pure $ levelDBNodeDB (MP.unStateDB $ _stateDB d)

-- | Build the context inside 'ContextM' (the SQL pool wants the logger),
-- then run the body under it. The builder runs under an inert in-memory
-- context.
runWithContext :: ContextM Context -> ContextM a -> StreamM '[Logger] (a, ContextState)
runWithContext mkCtx f = do
  seed <- memContext (const (pure Nothing)) Nothing
  ctx <- runContextIO seed mkCtx
  a <- runContextIO ctx f
  (a,) <$> readIORef (_state ctx)

-- | The VM's capabilities are exactly 'ContextM''s; functions written against
-- an abstract @VMBase m@ compile as monomorphic 'ContextM' code.
type VMBase m = (m ~ ContextM)

withCurrentBlockHash ::
  ( MonadLogger m,
    Mod.Modifiable MemDBs m,
    Mod.Modifiable CurrentBlockHash m,
    HasMemAddressStateDB m,
    (Maybe Word256 `A.Alters` MP.StateRoot) m,
    (MP.StateRoot `A.Alters` MP.NodeData) m,
    (Address `A.Alters` AddressState) m,
    (N.NibbleString `A.Alters` N.NibbleString) m,
    HasMemRawStorageDB m,
    (RawStorageKey `A.Alters` RawStorageValue) m
  ) =>
  Keccak256 ->
  m a ->
  m a
withCurrentBlockHash bh f = do
  cbh <- Mod.get (Mod.Proxy @CurrentBlockHash)
  Mod.put (Mod.Proxy @CurrentBlockHash) (CurrentBlockHash bh)
  a <- f
  flushMemStorageDB
  resetAddressStateTxDBMap
  flushMemAddressStateDB
  sr <- A.lookup (A.Proxy @MP.StateRoot) (Nothing :: Maybe Word256)
  Mod.modify_ (Mod.Proxy @MemDBs) $ pure . (stateRoots .~ M.empty) . (flushedRoot .~ sr)
  Mod.put (Mod.Proxy @CurrentBlockHash) cbh
  pure a

withCurrentBlockHashNoCommit ::
  ( MonadUnliftIO m,
    Mod.Modifiable MemDBs m,
    Mod.Modifiable CurrentBlockHash m
  ) =>
  Keccak256 ->
  m a ->
  m a
withCurrentBlockHashNoCommit bh f = do
  memDBs' <- Mod.get (Mod.Proxy @MemDBs)
  let restore = Mod.put (Mod.Proxy @MemDBs) memDBs'
  Mod.put (Mod.Proxy @CurrentBlockHash) (CurrentBlockHash bh)
  a <- f `onException` restore
  restore
  pure a


instance Show Context where
  show = const "<context>"

runTestContextM ::
  HasStateDB ContextM =>
  ContextM a ->
  Eff '[Logger] (a, ContextState)
runTestContextM f =
  withRunInIO $ \runInIO -> withSystemTempDirectory "test_evm_context" $ \tmpdir ->
    withTempFile tmpdir "evm.sqlite" $ \filepath _ -> runInIO $ do
      env <- createStreamEnv "test" (tmpdir ++ "/jlog", 0)
      let mkCtx = do
            conn <- Lite.createSqlitePool (T.pack filepath) 20
            let ldbOptions =
                  DB.defaultOptions
                    { DB.createIfMissing = True,
                      DB.cacheSize = Conf.cacheSize (levelDBConfig ethConf),
                      DB.blockSize = Conf.blockSize (levelDBConfig ethConf)
                    }
                openDB base = DB.open (tmpdir ++ base) ldbOptions
            sdb <- openDB stateDBPath
            hdb <- openDB hashDBPath
            cdb <- openDB codeDBPath
            blksumdb <- openDB blockSummaryCacheDBPath
            rPool <-
              liftIO . Redis.connect $
                Redis.defaultConnectInfo
                  { Redis.connectHost = "localhost",
                    Redis.connectPort = Redis.PortNumber 2023,
                    Redis.connectDatabase = 0
                  }
            cache <- liftIO $ TRC.new 64
            cstate <-
              newIORef $
                def
                  & vmGasCap .~ 100000
                  & runningTests .~ True
                  & txRunResultsCache .~ cache
            que <- newTQueueIO
            pure
              Context
                { _backend =
                    Persistent
                      ContextDBs
                        { _stateDB = MP.StateDB sdb,
                          _hashDB = HashDB hdb,
                          _codeDB = CodeDB cdb,
                          _blockSummaryDB = BlockSummaryDB blksumdb,
                          _redisPool = RBDB.RedisConnection rPool,
                          _sqldb = SQLDB conn
                        },
                  _state = cstate,
                  _stateDiffQueue = que,
                  _resolveFile = const (pure Nothing),
                  _fetchMissingNodes = False
                }
      runStreamMUsingEnv env . runWithContext mkCtx $ do
        MP.initializeBlank
        setStateDBStateRoot Nothing MP.emptyTriePtr
        f

initContext :: ContextM Context
initContext = initContextWithLevelDBTuning
  (Conf.cacheSize $ levelDBConfig ethConf)
  (DB.writeBufferSize DB.defaultOptions)

initContextWithLevelDBTuning :: Int -> Int -> ContextM Context
initContextWithLevelDBTuning = initContextWithOptions

initReplayContext :: ContextM Context
initReplayContext = initContextWithOptions
  (Conf.cacheSize $ levelDBConfig ethConf)
  (DB.writeBufferSize DB.defaultOptions)

initContextWithOptions :: Int -> Int -> ContextM Context
initContextWithOptions cacheBytes writeBufferBytes = do
  liftIO $ createDirectoryIfMissing False $ dbDir "h"
  conn <- createPostgresqlPool connStr 20
  let ldbOptions =
        DB.defaultOptions
          { DB.createIfMissing = True,
            DB.cacheSize = cacheBytes,
            DB.blockSize = Conf.blockSize (levelDBConfig ethConf),
            DB.writeBufferSize = writeBufferBytes
          }
  sdb <- DB.open (dbDir "h" ++ stateDBPath) ldbOptions
  hdb <- DB.open (dbDir "h" ++ hashDBPath) ldbOptions
  cdb <- DB.open (dbDir "h" ++ codeDBPath) ldbOptions
  blksumdb <- DB.open (dbDir "h" ++ blockSummaryCacheDBPath) ldbOptions
  rPool <- liftIO $ Redis.checkedConnect lookupRedisBlockDBConfig
  cache <- liftIO $ TRC.new 64

  let cdbs =
        ContextDBs
          { _stateDB = MP.StateDB sdb,
            _hashDB = HashDB hdb,
            _codeDB = CodeDB cdb,
            _blockSummaryDB = BlockSummaryDB blksumdb,
            _redisPool = RBDB.RedisConnection rPool,
            _sqldb = conn
          }

  cstate <-
    newIORef $
      def
        & txRunResultsCache .~ cache
  que <- newTQueueIO
  pure
    Context
      { _backend = Persistent cdbs,
        _state = cstate,
        _stateDiffQueue = que,
        _resolveFile = const (pure Nothing),
        _fetchMissingNodes = False
      }

-- | The node's entry point: one @Env -> IO@ layer from here on. The streaming
-- environment is opened around the run and the context is built inside it.
runContextM :: T.Text -> ContextM Context -> ContextM a -> Eff '[Logger] (a, ContextState)
runContextM clientId mkCtx f = runStreamMConfigured clientId (runWithContext mkCtx f)

evalContextM :: T.Text -> ContextM Context -> ContextM a -> Eff '[Logger] a
evalContextM clientId mkCtx f = fst <$> runContextM clientId mkCtx f

execContextM :: T.Text -> ContextM Context -> ContextM a -> Eff '[Logger] ContextState
execContextM clientId mkCtx f = snd <$> runContextM clientId mkCtx f

-- | A context over in-memory stores only: no LevelDB, SQL, or Redis.
memContext :: MonadIO m => (FilePath -> IO (Maybe (Either String String))) -> Maybe DebugSettings -> m Context
memContext resolver dSettings = liftIO $ do
  overlay <- newIORef def
  cache <- TRC.new 64
  cstate <-
    newIORef $
      def
        & txRunResultsCache .~ cache
        & debugSettings .~ dSettings
  que <- newTQueueIO
  pure
    Context
      { _backend = Memory overlay,
        _state = cstate,
        _stateDiffQueue = que,
        _resolveFile = resolver,
        _fetchMissingNodes = False
      }

-- | In-memory stores and no stream (CLI, fuzzer, benchmarks).
runMemContextM ::
  HasStateDB ContextM =>
  (FilePath -> IO (Maybe (Either String String))) ->
  Maybe DebugSettings ->
  ContextM a ->
  Eff '[Logger] (a, MemContextDBs)
runMemContextM resolver dSettings f = do
  sref <- liftIO $ newIORef . StreamEnv "" "mem" =<< newIORef M.empty
  ctx <- memContext resolver dSettings
  a <- provide sref . runContextIO ctx $ do
    MP.initializeBlank
    setStateDBStateRoot Nothing MP.emptyTriePtr
    f
  case _backend ctx of
    Memory overlay -> (a,) <$> readIORef overlay
    _ -> error "runMemContextM: backend changed"

evalMemContextM ::
  HasStateDB ContextM =>
  (FilePath -> IO (Maybe (Either String String))) ->
  Maybe DebugSettings ->
  ContextM a ->
  Eff '[Logger] a
evalMemContextM resolver dSettings f = fst <$> runMemContextM resolver dSettings f

-- | Run against a copy of the state with all writes held in an overlay, so
-- nothing the body does reaches the stores or the caller's state.
evalSandboxedContextM :: ContextM a -> ContextM a
evalSandboxedContextM f = do
  ctx <- accessEnv
  st <- newIORef =<< readIORef (_state ctx)
  sandboxed <- case _backend ctx of
    Persistent d -> Sandbox <$> newIORef def <*> pure d
    Sandbox o d -> Sandbox <$> (newIORef =<< readIORef o) <*> pure d
    Memory o -> Memory <$> (newIORef =<< readIORef o)
  nodes <- newIORef M.empty
  ContextM . localEnv @Context (const ctx {_backend = sandboxed, _state = st}) . localEnv @NodeDB (overlayNodeDB nodes) $ unContextM f

-- | Fetch Merkle-Patricia nodes missing locally from peers for the body's duration.
withFetchMissingNodes :: ContextM a -> ContextM a
withFetchMissingNodes f = do
  ctx <- accessEnv
  ContextM $ localEnv @Context (const ctx {_fetchMissingNodes = True}) (unContextM f)

incrementNonce :: (Address `A.Alters` AddressState) f => Address -> f ()
incrementNonce address = A.adjustWithDefault_ Mod.Proxy address $ \addressState ->
  pure addressState {addressStateNonce = addressStateNonce addressState + 1}

getNewAddress :: (MonadIO m, (Address `A.Alters` AddressState) m) => Address -> m Address
getNewAddress address = do
  nonce' <- addressStateNonce <$> A.lookupWithDefault Mod.Proxy address
  when flags_debug $ liftIO $ putStrLn $ "Creating new address: owner=" ++ format address ++ ", nonce=" ++ show nonce'
  let newAddress = getNewAddress_unsafe address nonce'
  incrementNonce address
  return newAddress

getNewAddressWithSalt :: (MonadIO m, MonadLogger m, (Address `A.Alters` AddressState) m) => Address -> Value -> Keccak256 -> [Value] -> m Address
getNewAddressWithSalt address salt hsh args = do
  nonce' <- addressStateNonce <$> A.lookupWithDefault Mod.Proxy address
  when flags_debug $ liftIO $ putStrLn $ "Creating new address: owner=" ++ format address ++ ", nonce=" ++ show nonce'
  let saltAsString = case salt of
        (SString s) -> s
        _ -> invalidArguments "big major bad" salt
  let newAddress = getNewAddressWithSalt_unsafe address saltAsString (keccak256ToByteString hsh) args
  $logDebugS "getNewAddressWithSalt" $ T.pack $ show address ++ " " ++ saltAsString ++ " " ++ (show $ keccak256ToByteString hsh) ++ " " ++ show args
  doesAddressAlreadyExist <- A.lookup (Mod.Proxy @AddressState) newAddress
  case doesAddressAlreadyExist of
    Just _ -> duplicateContract $ "The address " ++ show newAddress ++ " already exists. Try using a different salt or constructor arguments."
    Nothing -> do
      incrementNonce address
      return newAddress

purgeStorageMap :: HasMemStorageDB m => Address -> m ()
purgeStorageMap address = do
  -- Drop the address's pending (unflushed) writes.
  bm <- getMemRawStorageBlockDB
  putMemRawStorageBlockMap $ foldr deleteBlockMap bm [k | k@(a, _) <- HS.toList (bmDirty bm), a == address]

getContextBestBlockInfo :: (Functor m, Mod.Accessible ContextState m) => m ContextBestBlockInfo
getContextBestBlockInfo = _bestBlockInfo <$> Mod.access Mod.Proxy

putContextBestBlockInfo :: Mod.Modifiable ContextState m => ContextBestBlockInfo -> m ()
putContextBestBlockInfo new = Mod.modify_ Mod.Proxy $ pure . (bestBlockInfo .~ new)

checkIfRunningTests :: (Functor m, Mod.Accessible ContextState m) => m Bool
checkIfRunningTests = _runningTests <$> Mod.access Mod.Proxy
