{-# LANGUAGE LambdaCase #-}
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
    flushMemDBs,
    startFromStateRoot,
    withCurrentBlockHashNoCommit,
    VMBase,
    ContextDBs (..),
    MemContextDBs (..),
    Backend (..),
    StateMirror (..),
    TrieAccess (..),
    stateMirror,
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
    isProposer,
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
import Control.Monad.Composable.NodeDB.Cached (cachedNodeDB)
import Control.Monad.Composable.Streaming (StreamEnv, StreamM, createStreamEnv, runStreamMUsingEnv, unconnectedStreamEnv)
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

-- | The state as something other than the trie holds it: vm-query's SQL
-- state mirror. Accounts, storage slots, code and block summaries are read by
-- key; there are no trie nodes and no hash preimages behind it.
data StateMirror = StateMirror
  { mirrorAccount :: Address -> IO (Maybe AddressState),
    mirrorStorage :: RawStorageKey -> IO (Maybe RawStorageValue),
    mirrorCode :: Keccak256 -> IO (Maybe DBCode),
    mirrorBlockSummary :: Keccak256 -> IO (Maybe BlockSummary),
    -- | Told of every read of the empty trie's root, the one trie node a
    -- mirror answers; a count of them says how often a run walked a storage
    -- trie instead of reading slots.
    mirrorEmptyTrieRead :: IO ()
  }

-- | Thrown when a run over a 'StateMirror' reaches for the state trie, which
-- the mirror cannot serve.
newtype TrieAccess = TrieAccess String
  deriving (Show)

instance Exception TrieAccess

-- | Where the stores live. 'Sandbox' reads through to the persistent stores
-- on a miss and keeps every write in the overlay (eth_call, tracing).
-- 'Mirror' does the same over a 'StateMirror': reads the block maps and the
-- overlay do not answer come from the mirror, and nothing is written to it.
data Backend
  = Persistent ContextDBs
  | Memory (IORef MemContextDBs)
  | Sandbox (IORef MemContextDBs) ContextDBs
  | Mirror (IORef MemContextDBs) StateMirror

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
    _selfAddress :: !Address,
    _isProposer :: !Bool
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
        _selfAddress = Address 0,
        _isProposer = True
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

-- | The mirror the context runs over, if it runs over one.
stateMirror :: ContextM (Maybe StateMirror)
stateMirror =
  accessEnv >>= \ctx -> pure $ case _backend ctx of
    Mirror _ m -> Just m
    _ -> Nothing
{-# INLINE stateMirror #-}

runContextIO :: Context -> ContextM a -> StreamM '[Logger] a
runContextIO ctx (ContextM m) = do
  db <- nodeDBFor (_backend ctx)
  a <- runNodeDBM db (provide ctx m)
  liftIO (flushNodes db)
  pure a

-- | Trie nodes live in LevelDB when there is one, behind a cache of 20k parsed
-- nodes (tens of MB) that writes through every 256 blocks and when the run
-- ends; a long-running loop must 'flushNodeDB' before acknowledging input.
-- Otherwise they live in a map for the run.
nodeDBFor :: MonadIO m => Backend -> m NodeDB
nodeDBFor (Memory _) = mapNodeDB <$> liftIO (newIORef M.empty)
nodeDBFor (Persistent d) = liftIO $ cachedNodeDB 20000 256 (levelDBBytes . MP.unStateDB $ _stateDB d)
nodeDBFor (Sandbox _ d) = pure $ nodeDB (levelDBBytes . MP.unStateDB $ _stateDB d)
nodeDBFor (Mirror _ m) = pure (mirrorNodeDB m)

-- | A mirror has no trie nodes. The empty trie's root is the one node there
-- is an answer for (there is nothing under it); any other read is a path the
-- mirror cannot serve, and says so. Writes are dropped.
mirrorNodeDB :: StateMirror -> NodeDB
mirrorNodeDB m =
  NodeDB
    { lookupNode = \sr ->
        if sr == MP.emptyTriePtr
          then Just MP.EmptyNodeData <$ mirrorEmptyTrieRead m
          else throwIO (TrieAccess ("state trie node " ++ format sr)),
      insertNode = \_ _ -> pure (),
      deleteNode = \_ -> pure (),
      tickNodes = pure (),
      flushNodes = pure ()
    }

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
  flushMemDBs
  Mod.modify_ (Mod.Proxy @MemDBs) $ pure . (stateRoots .~ M.empty)
  Mod.put (Mod.Proxy @CurrentBlockHash) cbh
  pure a

-- | Write the block maps to the trie and record the root it produced: the
-- root the entries retained in the maps now describe. Every flush must go
-- through here, or 'startFromStateRoot' cannot tell a stale map from a fresh one.
flushMemDBs ::
  ( MonadLogger m,
    Mod.Modifiable MemDBs m,
    HasMemAddressStateDB m,
    (Maybe Word256 `A.Alters` MP.StateRoot) m,
    (MP.StateRoot `A.Alters` MP.NodeData) m,
    (Address `A.Alters` AddressState) m,
    (N.NibbleString `A.Alters` N.NibbleString) m,
    HasMemRawStorageDB m,
    (RawStorageKey `A.Alters` RawStorageValue) m
  ) =>
  m ()
flushMemDBs = do
  flushMemStorageDB
  resetAddressStateTxDBMap
  flushMemAddressStateDB
  sr <- A.lookup (A.Proxy @MP.StateRoot) (Nothing :: Maybe Word256)
  Mod.modify_ (Mod.Proxy @MemDBs) $ pure . (flushedRoot .~ sr)

-- | Begin running transactions from @sr@. The block maps may keep what the last
-- flush left in them only if this run continues from the root that flush
-- produced; a run starting anywhere else (an ancestor, a sibling branch) must
-- not see them. Every run must start through here.
startFromStateRoot ::
  ( Mod.Modifiable MemDBs m,
    HasMemAddressStateDB m,
    HasMemRawStorageDB m,
    (Maybe Word256 `A.Alters` MP.StateRoot) m
  ) =>
  MP.StateRoot ->
  m ()
startFromStateRoot sr = do
  A.insert (A.Proxy @MP.StateRoot) (Nothing :: Maybe Word256) sr
  startSR <- A.lookup (A.Proxy @MP.StateRoot) (Nothing :: Maybe Word256)
  fr <- _flushedRoot <$> Mod.get (Mod.Proxy @MemDBs)
  when (startSR /= fr) $ do
    putAddressStateBlockDBMap emptyBlockMap
    putMemRawStorageBlockMap emptyBlockMap

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
      env <- createStreamEnv "test" (tmpdir ++ "/stream", 0)
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
                          _sqldb = sqlDB conn
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
  liftIO $ mapM_ removeStaleInfoLog [stateDBPath, hashDBPath, codeDBPath, blockSummaryCacheDBPath]
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

-- LevelDB renames LOG to LOG.old when a database is opened and never reads
-- either file, so the previous run's log would otherwise sit on disk until
-- the restart after next.
removeStaleInfoLog :: FilePath -> IO ()
removeStaleInfoLog dbPath = do
  let f = dbDir "h" ++ dbPath ++ "LOG.old"
  exists <- doesFileExist f
  when exists $ removeFile f

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
  sref <- newIORef =<< unconnectedStreamEnv "mem"
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
    Mirror o m -> Mirror <$> (newIORef =<< readIORef o) <*> pure m
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
