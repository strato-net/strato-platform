{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE UndecidableInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

-- | The SQL-backed VM context: 'VMBase' satisfied by Postgres reads.
--
-- vm-runner's JSON-RPC handlers ("Blockchain.JsonRpcCommand") are written
-- against the 'VMBase' constraint set, so a query VM is not a second VM but
-- a base monad whose persistent reads come from the state mirror instead of
-- the trie: accounts from @address_state_ref@, SolidVM storage from
-- @storage@, code from @code_ref@, block headers from @block_data_ref@.
-- Writes land in the in-memory overlay that the handlers already use per
-- command (the sandbox), so nothing here can touch the database. Trie-level
-- reads (state trie nodes, hash preimages) are not available from SQL and
-- fail loudly; the spike counts on that to find any handler path that still
-- needs the trie.
module Blockchain.VmQuery.SqlContext
  ( SqlQueryEnv (..),
    SqlQueryM,
    newSqlQueryEnv,
    newSqlQueryEnvWith,
    bestHeaderFromDb,
    runSqlQueryM,
    withFreshOverlay,
    resetForRequest,
    readRoundTrips,
    readSqlNanos,
    setSnapshot,
    setCacheMaxRows,
    setPrefetchMaxRows,
    setPrefetchAfterSlots,
    cacheSizes,
    defaultCacheMaxRows,
    readEmptyTrieReads,
    resetRoundTrips,
    bestHeader,
    loadBestHeader,
    loadAddressState,
    bdrToHeader,
    TrieAccess (..),
  )
where

import Blockchain.DB.BlockSummaryDB ()
import Blockchain.DB.ChainDB (BlockHashRoot (..))
import Blockchain.DB.CodeDB (DBCode)
import Blockchain.DB.MemAddressStateDB (AddressStateModification (..), HasMemAddressStateDB (..))
import Blockchain.DB.RawStorageDB (HasMemRawStorageDB (..), RawStorageKey, RawStorageValue)
import Blockchain.DB.SQLDB
import Blockchain.Data.AddressStateDB (AddressState (..), blankAddressState)
import Blockchain.Data.AddressStateRef (addressStateRefCodePtr)
import Blockchain.Data.BlockHeader (BlockHeader (..))
import Blockchain.Data.BlockSummary (BlockSummary, blockHeaderToBSum)
import Blockchain.Data.DataDefs
import Blockchain.Data.ProposalFacts (noProposalFacts)
import Blockchain.Data.VmTrace (VmTracer)
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.EthConf (ethConf)
import qualified Blockchain.EthConf.Model as Conf
import Blockchain.Model.JsonBlock (blockDataRefToBlock)
import Blockchain.Data.Block (blockBlockData)
import Blockchain.Strato.Model.Address (Address)
import Blockchain.Strato.Model.Class (blockHeaderHash)
import Blockchain.Strato.Model.ExtendedWord (Word256)
import Blockchain.Strato.Model.Keccak256 (Keccak256, unsafeCreateKeccak256FromWord256)
import qualified Blockchain.TxRunResultCache as TRC
import Blockchain.VMContext (ContextBestBlockInfo (..), ContextState (..), CurrentBlockHash (..), GasCap (..), HasPendingMPNodes (..), MemDBs (..))
import Control.Monad.Catch (MonadCatch, MonadMask, MonadThrow)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Base (AccessibleEnv (..))
import Control.Concurrent.MVar (MVar, withMVar)
import Control.Monad.IO.Unlift (MonadUnliftIO, withRunInIO)
import Control.Monad.Trans.Resource (ResourceT, runResourceT)
import Control.Monad.Logger
import Control.Monad.Reader
import Control.Monad (when)
import Data.Foldable (forM_)
import Data.Default (def)
import Data.IORef
import System.Environment (lookupEnv)
import GHC.Clock (getMonotonicTimeNSec)
import qualified Data.Map.Strict as M
import Data.Maybe (fromMaybe, isJust, isNothing)
import qualified Data.NibbleString as N
import qualified Data.Text as T
import Data.Text.Encoding (encodeUtf8)
import Database.Persist ((==.))
import qualified Database.Persist as P
import qualified Database.Persist.Sql as SQL
import Database.Persist.Sql (SqlBackend)
import Debugger (DebugSettings)
import Prometheus (Counter, Gauge, Histogram, Info (..), counter, gauge, histogram, incCounter, observe, setGauge, unsafeRegister)
import SolidVM.Model.Storable (BasicValue (..))
import UnliftIO.Exception (Exception, throwIO)

-- | Thrown when a handler reaches for the state trie, which SQL cannot serve.
data TrieAccess = TrieAccess String
  deriving (Show)

instance Exception TrieAccess

data SqlQueryEnv = SqlQueryEnv
  { sqeDb :: SQLDB,
    sqeState :: IORef ContextState,
    sqeBlockHashRoot :: IORef BlockHashRoot,
    -- | Code added during a command (a sandboxed create) lives here, never in SQL.
    sqeCodeOverlay :: IORef (M.Map Keccak256 DBCode),
    sqeSummaries :: IORef (M.Map Keccak256 BlockSummary),
    -- | SQL statements issued through this context, for the spike's counts.
    sqeRoundTrips :: IORef Int,
    -- | Reads of the empty trie's root node, the one trie read SQL can
    -- answer (there is nothing under it); counted so the spike can say how
    -- often handlers walk a storage trie rather than read slots.
    sqeEmptyTrieReads :: IORef Int,
    -- | Per-command caches, cleared with the overlay: the row id behind an
    -- address (so a slot costs one query, not two) and the addresses whose
    -- storage was prefetched whole (so a contract's slots cost one query).
    sqeAccountIds :: IORef (M.Map Address (Maybe AddressStateRefId)),
    -- | Per address: n >= 0 means its storage was prefetched whole (n
    -- rows); n < 0 means it was too large for the threshold and has been
    -- read slot by slot -n times this epoch (see 'sqePrefetchAfterSlots').
    sqePrefetched :: IORef (M.Map Address Int),
    -- | Account rows read during this command; the handlers read the same
    -- account several times per call (resolution, then execution).
    sqeAccounts :: IORef (M.Map Address (Maybe AddressState)),
    -- | Nanoseconds spent inside SQL queries this command (wall clock).
    sqeSqlNanos :: IORef Integer,
    -- | Mirror rows read so far, kept across requests while the mirror's
    -- best block is unchanged (the indexer commits a block's header and its
    -- state diffs in one transaction, so the same best block means the same
    -- rows). Consulted after the command's overlay, before SQL.
    sqeStorageCache :: IORef (M.Map RawStorageKey (Maybe RawStorageValue)),
    sqeCacheBlock :: IORef (Maybe Keccak256),
    -- | When set, mirror reads run on this pinned connection (a repeatable
    -- read transaction opened at the block epoch) instead of the pool, so
    -- every row of the epoch is one consistent state with its header. The
    -- connection is shared by the epoch's requests and serialised by the
    -- MVar; only cache misses reach it.
    sqeSnapshot :: IORef (Maybe (MVar SqlBackend)),
    -- | Cap on cached storage rows per context. Past it the row cache and
    -- the prefetched set are dropped whole and refilled on demand, so a
    -- context's memory is bounded by the cap however much a block's
    -- requests touch. Accounts are capped at a tenth of it.
    sqeCacheMaxRows :: IORef Int,
    -- | Contracts with at most this many storage rows are read whole on
    -- their first slot access ('prefetchStorage'); larger ones slot by slot.
    sqePrefetchMaxRows :: IORef Int,
    -- | A contract above the threshold whose slots a context has read this
    -- many times in one epoch is prefetched whole after all (up to the
    -- cache cap): a call walking an array pays one query, not one per
    -- element. 0 disables promotion.
    sqePrefetchAfterSlots :: IORef Int
  }

-- | Default cap: a row is a few hundred bytes, so this is tens of MB.
defaultCacheMaxRows :: Int
defaultCacheMaxRows = 200000

{-# NOINLINE cacheEvictions #-}
cacheEvictions :: Counter
cacheEvictions = unsafeRegister . counter $ Info "vm_query_cache_evictions_total" "Times a context's row cache was dropped for exceeding the cap"

{-# NOINLINE cacheRowsGauge #-}
cacheRowsGauge :: Gauge
cacheRowsGauge = unsafeRegister . gauge $ Info "vm_query_cache_rows" "Storage rows cached by the context that most recently finished a request"

-- | Default for 'sqePrefetchMaxRows': contracts with at most this many
-- storage rows are read in one query on their first slot access, larger
-- ones slot by slot. See the design document for how it was chosen.
defaultPrefetchMaxRows :: Int
defaultPrefetchMaxRows = 4096

-- | Default for 'sqePrefetchAfterSlots'.
defaultPrefetchAfterSlots :: Int
defaultPrefetchAfterSlots = 64

{-# NOINLINE prefetchRowsHistogram #-}
prefetchRowsHistogram :: Histogram
prefetchRowsHistogram = unsafeRegister . histogram (Info "vm_query_prefetch_rows" "Rows loaded by whole-contract prefetches") $ [16, 64, 256, 1024, 4096, 16384, 65536]

{-# NOINLINE prefetchDeclined #-}
prefetchDeclined :: Counter
prefetchDeclined = unsafeRegister . counter $ Info "vm_query_prefetch_declined_total" "Contracts read slot by slot because they exceed the prefetch threshold (once per contract per epoch per context)"

{-# NOINLINE prefetchPromoted #-}
prefetchPromoted :: Counter
prefetchPromoted = unsafeRegister . counter $ Info "vm_query_prefetch_promoted_total" "Contracts above the threshold prefetched whole after enough slot reads in one epoch"

newtype SqlQueryM a = SqlQueryM {unSqlQueryM :: ReaderT SqlQueryEnv (LoggingT IO) a}
  deriving (Functor, Applicative, Monad, MonadIO, MonadReader SqlQueryEnv, MonadLogger, MonadLoggerIO, MonadThrow, MonadCatch, MonadMask, MonadUnliftIO)

-- | VMQ_LOG=debug|info shows the handlers' own logging (function
-- resolution, proxy following); the default is warnings only.
runSqlQueryM :: SqlQueryEnv -> SqlQueryM a -> IO a
runSqlQueryM env m = do
  level <- lookupEnv "VMQ_LOG"
  let minLevel = case level of
        Just "debug" -> LevelDebug
        Just "info" -> LevelInfo
        _ -> LevelWarn
  runStderrLoggingT . filterLogger (\_ lvl -> lvl >= minLevel) $ runReaderT (unSqlQueryM m) env

-- | A context over the given pool, positioned at the mirror's best block.
newSqlQueryEnv :: SQLDB -> IO SqlQueryEnv
newSqlQueryEnv db = do
  env <- newSqlQueryEnvWith db Nothing
  runSqlQueryM env loadBestHeader
  pure env

-- | The mirror's best block header, for callers that cache it.
bestHeaderFromDb :: SQLDB -> IO (Maybe BlockHeader)
bestHeaderFromDb db = do
  env <- newSqlQueryEnvWith db Nothing
  runSqlQueryM env (loadBestHeader >> bestHeader)

-- | A context positioned at the given header (no query), or unpositioned.
newSqlQueryEnvWith :: SQLDB -> Maybe BlockHeader -> IO SqlQueryEnv
newSqlQueryEnvWith db mHeader = do
  cache <- TRC.new 64
  stateRef <- newIORef (def {_txRunResultsCache = cache})
  bhr <- newIORef (BlockHashRoot MP.emptyTriePtr)
  code <- newIORef M.empty
  sums <- newIORef M.empty
  trips <- newIORef 0
  emptyReads <- newIORef 0
  ids <- newIORef M.empty
  pre <- newIORef M.empty
  accts <- newIORef M.empty
  sqlNanos <- newIORef 0
  storageCache <- newIORef M.empty
  cacheBlock <- newIORef Nothing
  snapshot <- newIORef Nothing
  maxRows <- newIORef defaultCacheMaxRows
  prefetchRows <- newIORef defaultPrefetchMaxRows
  afterSlots <- newIORef defaultPrefetchAfterSlots
  let env = SqlQueryEnv db stateRef bhr code sums trips emptyReads ids pre accts sqlNanos storageCache cacheBlock snapshot maxRows prefetchRows afterSlots
  forM_ mHeader $ \header ->
    modifyIORef' stateRef (\s -> s {_bestBlockInfo = ContextBestBlockInfo (blockHeaderHash header) header 0})
  pure env

-- | Make a pooled context ready for the next request. Per-command state
-- always goes: the overlay, code added by a sandboxed create, a trace
-- command's tracer and debug settings, the gas cap, the counters. The
-- mirror caches (account rows, storage rows, prefetched addresses) go only
-- when the best block has changed since they were filled; the block summary
-- and tx-run caches are keyed by immutable hashes and stay.
resetForRequest :: Maybe BlockHeader -> SqlQueryM ()
resetForRequest mHeader = do
  env <- ask
  liftIO $ do
    modifyIORef' (sqeState env) $ \s ->
      (def {_txRunResultsCache = _txRunResultsCache s})
        { _bestBlockInfo = maybe Unspecified (\h -> ContextBestBlockInfo (blockHeaderHash h) h 0) mHeader }
    writeIORef (sqeBlockHashRoot env) (BlockHashRoot MP.emptyTriePtr)
    writeIORef (sqeCodeOverlay env) M.empty
    writeIORef (sqeRoundTrips env) 0
    writeIORef (sqeEmptyTrieReads env) 0
    writeIORef (sqeSqlNanos env) 0
    writeIORef (sqeSnapshot env) Nothing
    let block = blockHeaderHash <$> mHeader
    cachedFor <- readIORef (sqeCacheBlock env)
    when (block /= cachedFor || block == Nothing) $ do
      writeIORef (sqeAccountIds env) M.empty
      writeIORef (sqePrefetched env) M.empty
      writeIORef (sqeAccounts env) M.empty
      writeIORef (sqeStorageCache env) M.empty
      writeIORef (sqeCacheBlock env) block

-- | Drop the command's overlay so the next command starts from the mirror.
withFreshOverlay :: SqlQueryM a -> SqlQueryM a
withFreshOverlay act = do
  env <- ask
  liftIO $ do
    modifyIORef' (sqeState env) (\s -> s {_memDBs = def})
    writeIORef (sqeCodeOverlay env) M.empty
    writeIORef (sqeAccountIds env) M.empty
    writeIORef (sqePrefetched env) M.empty
    writeIORef (sqeAccounts env) M.empty
    writeIORef (sqeStorageCache env) M.empty
    writeIORef (sqeCacheBlock env) Nothing
  act

readRoundTrips :: SqlQueryM Int
readRoundTrips = asks sqeRoundTrips >>= liftIO . readIORef

readEmptyTrieReads :: SqlQueryM Int
readEmptyTrieReads = asks sqeEmptyTrieReads >>= liftIO . readIORef

resetRoundTrips :: SqlQueryM ()
resetRoundTrips = do
  asks sqeRoundTrips >>= liftIO . flip writeIORef 0
  asks sqeSqlNanos >>= liftIO . flip writeIORef 0

readSqlNanos :: SqlQueryM Integer
readSqlNanos = asks sqeSqlNanos >>= liftIO . readIORef

countTrip :: SqlQueryM ()
countTrip = asks sqeRoundTrips >>= liftIO . flip modifyIORef' (+ 1)

-- | A mirror read: on the epoch's pinned snapshot connection when there is
-- one, else on the pool in its own transaction. Counted and timed.
mirrorQuery :: SQL.SqlPersistT (ResourceT SqlQueryM) a -> SqlQueryM a
mirrorQuery q = do
  countTrip
  t0 <- liftIO getMonotonicTimeNSec
  snap <- asks sqeSnapshot >>= liftIO . readIORef
  r <- case snap of
    Just conn -> withRunInIO $ \runIO -> withMVar conn $ \backend -> runIO (runResourceT (runReaderT q backend))
    Nothing -> sqlQuery q
  t1 <- liftIO getMonotonicTimeNSec
  asks sqeSqlNanos >>= liftIO . flip modifyIORef' (+ fromIntegral (t1 - t0))
  pure r

-- | Pin (or unpin) the epoch's snapshot connection for this context.
setSnapshot :: Maybe (MVar SqlBackend) -> SqlQueryM ()
setSnapshot m = asks sqeSnapshot >>= liftIO . flip writeIORef m

setCacheMaxRows :: Int -> SqlQueryM ()
setCacheMaxRows n = asks sqeCacheMaxRows >>= liftIO . flip writeIORef (max 1 n)

setPrefetchMaxRows :: Int -> SqlQueryM ()
setPrefetchMaxRows n = asks sqePrefetchMaxRows >>= liftIO . flip writeIORef (max 0 n)

setPrefetchAfterSlots :: Int -> SqlQueryM ()
setPrefetchAfterSlots n = asks sqePrefetchAfterSlots >>= liftIO . flip writeIORef (max 0 n)

-- | Sizes of the per-block caches: (storage rows, accounts).
cacheSizes :: SqlQueryM (Int, Int)
cacheSizes = do
  env <- ask
  liftIO $ (,) <$> (M.size <$> readIORef (sqeStorageCache env)) <*> (M.size <$> readIORef (sqeAccounts env))

-- | Drop the caches whole when past the cap. Called before a fill, never
-- between a fill and the read that needed it, so a read always sees what
-- it just loaded; a fill may therefore overshoot the cap by one contract's
-- rows (at most the cap itself, see prefetchStorage), which bounds a
-- context's memory at twice the cap.
enforceCacheCap :: SqlQueryM ()
enforceCacheCap = do
  env <- ask
  liftIO $ do
    cap <- readIORef (sqeCacheMaxRows env)
    rows <- M.size <$> readIORef (sqeStorageCache env)
    accounts <- M.size <$> readIORef (sqeAccounts env)
    when (rows > cap || accounts > max 1 (cap `div` 10)) $ do
      writeIORef (sqeStorageCache env) M.empty
      writeIORef (sqePrefetched env) M.empty
      writeIORef (sqeAccounts env) M.empty
      writeIORef (sqeAccountIds env) M.empty
      incCounter cacheEvictions
    setGauge cacheRowsGauge . fromIntegral =<< (M.size <$> readIORef (sqeStorageCache env))

-- --- SQL reads ---

bdrToHeader :: BlockDataRef -> BlockHeader
bdrToHeader bdr = blockBlockData (blockDataRefToBlock bdr [] [] [] [] [] [])

-- | The highest block the mirror holds becomes the context's best block.
loadBestHeader :: SqlQueryM ()
loadBestHeader = do
  mBdr <- mirrorQuery $ P.selectFirst [] [P.Desc BlockDataRefNumber]
  case mBdr of
    Nothing -> logWarnN "vm-query: block_data_ref is empty, eth_call has no best block"
    Just (P.Entity _ bdr) -> do
      let header = bdrToHeader bdr
      ref <- asks sqeState
      liftIO $ modifyIORef' ref (\s -> s {_bestBlockInfo = ContextBestBlockInfo (blockHeaderHash header) header 0})

bestHeader :: SqlQueryM (Maybe BlockHeader)
bestHeader = do
  s <- asks sqeState >>= liftIO . readIORef
  pure $ case _bestBlockInfo s of
    ContextBestBlockInfo _ h _ -> Just h
    Unspecified -> Nothing

loadAddressState :: Address -> SqlQueryM (Maybe AddressState)
loadAddressState addr = do
  ref <- asks sqeAccounts
  cached <- liftIO $ readIORef ref
  case M.lookup addr cached of
    Just st -> pure st
    Nothing -> do
      enforceCacheCap
      mRow <- mirrorQuery $ P.getBy (UniqueAddress addr)
      let st = flip fmap mRow $ \(P.Entity _ r) ->
            AddressState
              { addressStateNonce = addressStateRefNonce r,
                addressStateBalance = addressStateRefBalance r,
                addressStateContractRoot = addressStateRefContractRoot r,
                addressStateCodeHash = fromMaybe (addressStateCodeHash blankAddressState) (addressStateRefCodePtr r),
                addressStateChainId = Nothing
              }
      -- The same row answers the id lookup for storage.
      liftIO $ modifyIORef' ref (M.insert addr st)
      idsRef <- asks sqeAccountIds
      liftIO $ modifyIORef' idsRef (M.insert addr (P.entityKey <$> mRow))
      pure st

-- | The row id behind an address, once per command.
accountId :: Address -> SqlQueryM (Maybe AddressStateRefId)
accountId addr = do
  ref <- asks sqeAccountIds
  cached <- liftIO $ readIORef ref
  case M.lookup addr cached of
    Just sid -> pure sid
    Nothing -> do
      sid <- fmap P.entityKey <$> mirrorQuery (P.getBy (UniqueAddress addr))
      liftIO $ modifyIORef' ref (M.insert addr sid)
      pure sid

-- | Whole-contract prefetch: the first slot read of an address with at most
-- 'sqePrefetchMaxRows' rows pulls every row into the cache in one query, and
-- every later slot of that address is an overlay hit. Returns the number of
-- rows loaded, or Nothing when the contract is too large for it.
prefetchStorage :: Address -> AddressStateRefId -> SqlQueryM (Maybe Int)
prefetchStorage addr sid = do
  ref <- asks sqePrefetched
  done <- liftIO $ readIORef ref
  cap <- asks sqeCacheMaxRows >>= liftIO . readIORef
  prefetchMax <- asks sqePrefetchMaxRows >>= liftIO . readIORef
  after <- asks sqePrefetchAfterSlots >>= liftIO . readIORef
  case M.lookup addr done of
    Just n | n >= 0 -> pure (Just n)
    -- Too large for the threshold: slot by slot, unless this context has
    -- read enough of its slots this epoch to make one query the cheaper
    -- path, in which case it is prefetched whole up to the cache cap.
    Just slotReads
      | after > 0 && negate slotReads >= after -> do
          r <- fetch cap
          when (isJust r) $ liftIO (incCounter prefetchPromoted)
          pure r
      | otherwise -> pure Nothing
    Nothing -> do
      r <- fetch (min prefetchMax cap)
      when (isNothing r) $ liftIO (incCounter prefetchDeclined)
      pure r
  where
    fetch limit = do
      ref <- asks sqePrefetched
      enforceCacheCap
      rows <- mirrorQuery $ P.selectList [StorageAddressStateRefId ==. sid] [P.LimitTo (limit + 1)]
      if length rows > limit
        then do
          liftIO $ modifyIORef' ref (M.insertWith (\_ old -> min old (-1)) addr (-1))
          pure Nothing
        else do
          cacheRef <- asks sqeStorageCache
          liftIO $ modifyIORef' cacheRef $ \cache ->
            foldr (\(P.Entity _ st) -> M.insert (addr, storageKey st) (Just (storageValue st))) cache rows
          liftIO $ modifyIORef' ref (M.insert addr (length rows))
          liftIO $ observe prefetchRowsHistogram (fromIntegral (length rows))
          pure (Just (length rows))

loadStorage :: Address -> RawStorageKey -> SqlQueryM (Maybe RawStorageValue)
loadStorage addr key@(_, path) = do
  cacheRef <- asks sqeStorageCache
  cache <- liftIO $ readIORef cacheRef
  case M.lookup key cache of
    Just v -> pure v
    Nothing -> do
      mSid <- accountId addr
      case mSid of
        Nothing -> pure Nothing
        Just sid -> do
          prefetched <- prefetchStorage addr sid
          case prefetched of
            -- Everything the contract has is cached now; absent means empty.
            Just _ -> M.findWithDefault Nothing key <$> liftIO (readIORef cacheRef)
            Nothing -> do
              enforceCacheCap
              rows <- mirrorQuery $ P.selectList [StorageAddressStateRefId ==. sid, StorageKey ==. path] [P.LimitTo 1]
              let v = case rows of
                    (P.Entity _ st : _) -> Just (storageValue st)
                    [] -> Nothing
              liftIO $ modifyIORef' cacheRef (M.insert key v)
              asks sqePrefetched >>= liftIO . flip modifyIORef' (M.adjust (subtract 1) addr)
              pure v

loadCode :: Keccak256 -> SqlQueryM (Maybe DBCode)
loadCode h = do
  mRow <- mirrorQuery $ P.getBy (UniqueCodeHash h)
  pure $ encodeUtf8 . codeRefCode . P.entityVal <$> mRow

loadSummary :: Keccak256 -> SqlQueryM (Maybe BlockSummary)
loadSummary h = do
  mBdr <- mirrorQuery $ P.selectFirst [BlockDataRefHash ==. h] []
  pure $ flip fmap mBdr $ \(P.Entity _ bdr) ->
    blockHeaderToBSum (fromIntegral (Conf.chainId (Conf.networkConfig ethConf))) noProposalFacts (bdrToHeader bdr) 0

-- --- Context plumbing ---

instance AccessibleEnv SQLDB SqlQueryM where
  accessEnv = asks sqeDb

stateGets :: (ContextState -> a) -> SqlQueryM a
stateGets f = asks sqeState >>= liftIO . fmap f . readIORef

stateModify :: (ContextState -> ContextState) -> SqlQueryM ()
stateModify f = asks sqeState >>= liftIO . flip modifyIORef' f

instance Mod.Modifiable ContextState SqlQueryM where
  get _ = stateGets id
  put _ s = stateModify (const s)

instance Mod.Accessible ContextState SqlQueryM where
  access _ = stateGets id

instance Mod.Modifiable (Maybe DebugSettings) SqlQueryM where
  get _ = stateGets _debugSettings
  put _ d = stateModify (\s -> s {_debugSettings = d})

instance Mod.Modifiable (Maybe VmTracer) SqlQueryM where
  get _ = stateGets _vmTracer
  put _ t = stateModify (\s -> s {_vmTracer = t})

instance Mod.Modifiable MemDBs SqlQueryM where
  get _ = stateGets _memDBs
  put _ m = stateModify (\s -> s {_memDBs = m})

instance Mod.Modifiable GasCap SqlQueryM where
  get _ = GasCap <$> stateGets _vmGasCap
  put _ (GasCap g) = stateModify (\s -> s {_vmGasCap = g})

instance Mod.Modifiable BlockHashRoot SqlQueryM where
  get _ = asks sqeBlockHashRoot >>= liftIO . readIORef
  put _ r = asks sqeBlockHashRoot >>= liftIO . flip writeIORef r

instance Mod.Modifiable CurrentBlockHash SqlQueryM where
  get _ = fromMaybe (CurrentBlockHash (unsafeCreateKeccak256FromWord256 0)) . _currentBlock <$> stateGets _memDBs
  put _ bh = stateModify (\s -> s {_memDBs = (_memDBs s) {_currentBlock = Just bh}})

instance HasPendingMPNodes SqlQueryM where
  flushPendingMPNodes = pure ()
  finalizePendingMPNodes = pure ()
  clearPendingMPNodes = pure ()

instance HasMemAddressStateDB SqlQueryM where
  getAddressStateTxDBMap = _stateTxMap <$> stateGets _memDBs
  putAddressStateTxDBMap m = stateModify (\s -> s {_memDBs = (_memDBs s) {_stateTxMap = m}})
  getAddressStateBlockDBMap = _stateBlockMap <$> stateGets _memDBs
  putAddressStateBlockDBMap m = stateModify (\s -> s {_memDBs = (_memDBs s) {_stateBlockMap = m}})

instance HasMemRawStorageDB SqlQueryM where
  getMemRawStorageTxDB = _storageTxMap <$> stateGets _memDBs
  putMemRawStorageTxMap m = stateModify (\s -> s {_memDBs = (_memDBs s) {_storageTxMap = m}})
  getMemRawStorageBlockDB = _storageBlockMap <$> stateGets _memDBs
  putMemRawStorageBlockMap m = stateModify (\s -> s {_memDBs = (_memDBs s) {_storageBlockMap = m}})

-- Accounts: the overlay first (a command's own writes), then the mirror.
instance (Address `A.Alters` AddressState) SqlQueryM where
  lookup _ addr = do
    tx <- getAddressStateTxDBMap
    case M.lookup addr tx of
      Just (ASModification st) -> pure (Just st)
      Just ASDeleted -> pure (Just blankAddressState)
      Nothing -> do
        blk <- getAddressStateBlockDBMap
        case M.lookup addr blk of
          Just (ASModification st) -> pure (Just st)
          Just ASDeleted -> pure (Just blankAddressState)
          Nothing -> loadAddressState addr
  insert _ addr st = getAddressStateTxDBMap >>= putAddressStateTxDBMap . M.insert addr (ASModification st)
  delete _ addr = getAddressStateTxDBMap >>= putAddressStateTxDBMap . M.insert addr ASDeleted

instance A.Selectable Address AddressState SqlQueryM where
  select _ = A.lookup (A.Proxy @AddressState)

-- Storage: overlay, then the mirror row for (address, path); a read is
-- cached in the overlay so a slot costs one query per command.
instance (RawStorageKey `A.Alters` RawStorageValue) SqlQueryM where
  lookup _ key = do
    tx <- getMemRawStorageTxDB
    case M.lookup key tx of
      Just v -> pure (Just v)
      Nothing -> do
        blk <- getMemRawStorageBlockDB
        case M.lookup key blk of
          Just v -> pure (Just v)
          Nothing -> Just . fromMaybe BDefault <$> loadStorage (fst key) key
  insert _ key v = getMemRawStorageTxDB >>= putMemRawStorageTxMap . M.insert key v
  delete _ key = getMemRawStorageTxDB >>= putMemRawStorageTxMap . M.insert key BDefault
  lookupWithDefault p key = fromMaybe BDefault <$> A.lookup p key

instance (Keccak256 `A.Alters` DBCode) SqlQueryM where
  lookup _ h = do
    overlay <- asks sqeCodeOverlay >>= liftIO . readIORef
    case M.lookup h overlay of
      Just c -> pure (Just c)
      Nothing -> loadCode h
  insert _ h c = asks sqeCodeOverlay >>= liftIO . flip modifyIORef' (M.insert h c)
  delete _ h = asks sqeCodeOverlay >>= liftIO . flip modifyIORef' (M.delete h)

instance A.Selectable FilePath (Either String String) SqlQueryM where
  select _ _ = pure Nothing

instance (Keccak256 `A.Alters` BlockSummary) SqlQueryM where
  lookup _ h = do
    cached <- asks sqeSummaries >>= liftIO . readIORef
    case M.lookup h cached of
      Just s -> pure (Just s)
      Nothing -> do
        ms <- loadSummary h
        forM_ ms $ \s -> asks sqeSummaries >>= liftIO . flip modifyIORef' (M.insert h s)
        pure ms
  insert _ h s = asks sqeSummaries >>= liftIO . flip modifyIORef' (M.insert h s)
  delete _ h = asks sqeSummaries >>= liftIO . flip modifyIORef' (M.delete h)

-- The main chain's state root is the best header's; private chains are not
-- served by the mirror.
instance (Maybe Word256 `A.Alters` MP.StateRoot) SqlQueryM where
  lookup _ Nothing = fmap stateRoot <$> bestHeader
  lookup _ (Just _) = pure Nothing
  insert _ _ _ = pure ()
  delete _ _ = pure ()

-- Trie nodes and hash preimages: not in SQL. Any handler path that gets
-- here is one the query VM cannot serve; say so.
instance (MP.StateRoot `A.Alters` MP.NodeData) SqlQueryM where
  lookup _ sr
    | sr == MP.emptyTriePtr = do
        asks sqeEmptyTrieReads >>= liftIO . flip modifyIORef' (+ 1)
        pure (Just MP.EmptyNodeData)
    | otherwise = throwIO (TrieAccess ("state trie node " ++ show sr))
  insert _ _ _ = pure ()
  delete _ _ = pure ()

instance (N.NibbleString `A.Alters` N.NibbleString) SqlQueryM where
  lookup _ k = throwIO (TrieAccess ("hash preimage " ++ show (T.pack (show k))))
  insert _ _ _ = pure ()
  delete _ _ = pure ()
