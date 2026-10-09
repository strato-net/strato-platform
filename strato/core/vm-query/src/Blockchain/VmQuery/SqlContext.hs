{-# LANGUAGE DataKinds #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

-- | The SQL-backed VM context: the node's 'ContextM' over the state mirror.
--
-- vm-runner's JSON-RPC handlers ("Blockchain.JsonRpcCommand") run in
-- 'ContextM', whose stores are chosen by the context's 'Backend'. A query VM
-- is therefore not a second VM but a context whose backend is a 'Mirror':
-- reads that the block maps do not answer come from the state mirror instead
-- of the trie: accounts from @address_state_ref@, SolidVM storage from
-- @storage@, code from @code_ref@, block headers from @block_data_ref@.
-- Writes land in the in-memory overlay that the handlers already use per
-- command, so nothing here can touch the database. Trie-level reads (state
-- trie nodes, hash preimages) are not available from SQL and fail loudly
-- ('TrieAccess'); the spike counts on that to find any handler path that
-- still needs the trie.
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

import Blockchain.DB.CodeDB (DBCode)
import Blockchain.DB.RawStorageDB (RawStorageKey, RawStorageValue)
import Blockchain.DB.SQLDB
import Blockchain.Data.AddressStateDB (AddressState (..), blankAddressState)
import Blockchain.Data.AddressStateRef (addressStateRefCodePtr)
import Blockchain.Data.Block (blockBlockData)
import Blockchain.Data.BlockHeader (BlockHeader (..))
import Blockchain.Data.BlockSummary (BlockSummary, blockHeaderToBSum)
import Blockchain.Data.DataDefs
import Blockchain.Data.ProposalFacts (noProposalFacts)
import Blockchain.EthConf (ethConf)
import qualified Blockchain.EthConf.Model as Conf
import Blockchain.Model.JsonBlock (blockDataRefToBlock)
import Blockchain.Strato.Model.Address (Address)
import Blockchain.Strato.Model.Class (blockHeaderHash)
import Blockchain.Strato.Model.Keccak256 (Keccak256)
import qualified Blockchain.TxRunResultCache as TRC
import Blockchain.VMContext (Backend (..), Context (..), ContextBestBlockInfo (..), ContextM, ContextState (..), MemContextDBs, StateMirror (..), TrieAccess (..), runContextIO)
import Control.Concurrent.MVar (MVar, withMVar)
import Control.Concurrent.STM (newTQueueIO)
import Control.Monad (when)
import Control.Monad.Composable.Base (Eff, provide, runEff, withLogger)
import Control.Monad.Composable.Streaming (runStreamMUsingEnv, unconnectedStreamEnv)
import Control.Monad.IO.Unlift (withRunInIO)
import Control.Monad.Logger (LogLevel (..), defaultOutput)
import Control.Monad.Trans.Reader (runReaderT)
import Control.Monad.Trans.Resource (ResourceT, runResourceT)
import Data.Default (def)
import Data.Foldable (forM_)
import Data.IORef
import qualified Data.Map.Strict as M
import Data.Maybe (fromMaybe, isJust, isNothing)
import Data.Text.Encoding (encodeUtf8)
import Database.Persist ((==.))
import qualified Database.Persist as P
import Database.Persist.Sql (SqlBackend)
import qualified Database.Persist.Sql as SQL
import GHC.Clock (getMonotonicTimeNSec)
import Prometheus (Counter, Gauge, Histogram, Info (..), counter, gauge, histogram, incCounter, observe, setGauge, unsafeRegister)
import SolidVM.Model.Storable (BasicValue (..))
import System.Environment (lookupEnv)
import System.IO (hPutStrLn, stderr)

data SqlQueryEnv = SqlQueryEnv
  { sqeDb :: SQLDB,
    sqeState :: IORef ContextState,
    -- | Code and block summaries added during a command (a sandboxed create)
    -- live here, never in SQL.
    sqeOverlay :: IORef MemContextDBs,
    -- | Block summaries read from the mirror; keyed by immutable hashes, so
    -- they are kept across requests.
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

-- | The handlers' monad. It is the node's own; what makes it a query VM is
-- the 'Mirror' backend 'runSqlQueryM' runs it over.
type SqlQueryM = ContextM

-- | A read against the mirror, on whichever connection serves it.
type MirrorQuery a = SQL.SqlPersistT (ResourceT (Eff '[SQLDB])) a

-- | Run handlers over the mirror behind @env@. VMQ_LOG=debug|info shows the
-- handlers' own logging (function resolution, proxy following); the default
-- is warnings only.
runSqlQueryM :: SqlQueryEnv -> SqlQueryM a -> IO a
runSqlQueryM env m = do
  level <- lookupEnv "VMQ_LOG"
  let minLevel = case level of
        Just "debug" -> LevelDebug
        Just "info" -> LevelInfo
        _ -> LevelWarn
      logger loc src lvl msg = when (lvl >= minLevel) $ defaultOutput stderr loc src lvl msg
  que <- newTQueueIO
  -- The handlers never touch the stream; the context only needs one in its row.
  stream <- unconnectedStreamEnv "vm-query"
  let ctx =
        Context
          { _backend = Mirror (sqeOverlay env) (mirrorOf env),
            _state = sqeState env,
            _stateDiffQueue = que,
            _resolveFile = const (pure Nothing),
            _fetchMissingNodes = False
          }
  runEff . withLogger logger . runStreamMUsingEnv stream $ runContextIO ctx m

-- | The mirror as the VM context reads it.
mirrorOf :: SqlQueryEnv -> StateMirror
mirrorOf env =
  StateMirror
    { mirrorAccount = loadAddressState env,
      -- A slot the mirror has no row for is an empty slot.
      mirrorStorage = \key -> Just . fromMaybe BDefault <$> loadStorage env (fst key) key,
      mirrorCode = loadCode env,
      mirrorBlockSummary = loadSummary env,
      mirrorEmptyTrieRead = modifyIORef' (sqeEmptyTrieReads env) (+ 1)
    }

-- | A context over the given pool, positioned at the mirror's best block.
newSqlQueryEnv :: SQLDB -> IO SqlQueryEnv
newSqlQueryEnv db = do
  env <- newSqlQueryEnvWith db Nothing
  loadBestHeader env
  pure env

-- | The mirror's best block header, for callers that cache it.
bestHeaderFromDb :: SQLDB -> IO (Maybe BlockHeader)
bestHeaderFromDb db = do
  env <- newSqlQueryEnvWith db Nothing
  loadBestHeader env
  bestHeader env

-- | A context positioned at the given header (no query), or unpositioned.
newSqlQueryEnvWith :: SQLDB -> Maybe BlockHeader -> IO SqlQueryEnv
newSqlQueryEnvWith db mHeader = do
  cache <- TRC.new 64
  stateRef <- newIORef (def {_txRunResultsCache = cache})
  overlay <- newIORef def
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
  let env = SqlQueryEnv db stateRef overlay sums trips emptyReads ids pre accts sqlNanos storageCache cacheBlock snapshot maxRows prefetchRows afterSlots
  forM_ mHeader $ \header ->
    modifyIORef' stateRef (\s -> s {_bestBlockInfo = ContextBestBlockInfo (blockHeaderHash header) header 0})
  pure env

-- | Make a pooled context ready for the next request. Per-command state
-- always goes: the block maps, code added by a sandboxed create, a trace
-- command's tracer and debug settings, the gas cap, the counters. The
-- mirror caches (account rows, storage rows, prefetched addresses) go only
-- when the best block has changed since they were filled; the block summary
-- and tx-run caches are keyed by immutable hashes and stay.
resetForRequest :: SqlQueryEnv -> Maybe BlockHeader -> IO ()
resetForRequest env mHeader = do
  modifyIORef' (sqeState env) $ \s ->
    (def {_txRunResultsCache = _txRunResultsCache s})
      { _bestBlockInfo = maybe Unspecified (\h -> ContextBestBlockInfo (blockHeaderHash h) h 0) mHeader }
  writeIORef (sqeOverlay env) def
  writeIORef (sqeRoundTrips env) 0
  writeIORef (sqeEmptyTrieReads env) 0
  writeIORef (sqeSqlNanos env) 0
  writeIORef (sqeSnapshot env) Nothing
  let block = blockHeaderHash <$> mHeader
  cachedFor <- readIORef (sqeCacheBlock env)
  when (block /= cachedFor || isNothing block) $ do
    writeIORef (sqeAccountIds env) M.empty
    writeIORef (sqePrefetched env) M.empty
    writeIORef (sqeAccounts env) M.empty
    writeIORef (sqeStorageCache env) M.empty
    writeIORef (sqeCacheBlock env) block

-- | Drop the command's overlay so the next command starts from the mirror.
withFreshOverlay :: SqlQueryEnv -> IO a -> IO a
withFreshOverlay env act = do
  modifyIORef' (sqeState env) (\s -> s {_memDBs = def})
  writeIORef (sqeOverlay env) def
  writeIORef (sqeAccountIds env) M.empty
  writeIORef (sqePrefetched env) M.empty
  writeIORef (sqeAccounts env) M.empty
  writeIORef (sqeStorageCache env) M.empty
  writeIORef (sqeCacheBlock env) Nothing
  act

readRoundTrips :: SqlQueryEnv -> IO Int
readRoundTrips = readIORef . sqeRoundTrips

readEmptyTrieReads :: SqlQueryEnv -> IO Int
readEmptyTrieReads = readIORef . sqeEmptyTrieReads

resetRoundTrips :: SqlQueryEnv -> IO ()
resetRoundTrips env = do
  writeIORef (sqeRoundTrips env) 0
  writeIORef (sqeSqlNanos env) 0

readSqlNanos :: SqlQueryEnv -> IO Integer
readSqlNanos = readIORef . sqeSqlNanos

-- | A mirror read: on the epoch's pinned snapshot connection when there is
-- one, else on the pool in its own transaction. Counted and timed.
mirrorQuery :: SqlQueryEnv -> MirrorQuery a -> IO a
mirrorQuery env q = do
  modifyIORef' (sqeRoundTrips env) (+ 1)
  t0 <- getMonotonicTimeNSec
  snap <- readIORef (sqeSnapshot env)
  r <- runEff . provide (sqeDb env) $ case snap of
    Just conn -> withRunInIO $ \runIO -> withMVar conn $ \backend -> runIO (runResourceT (runReaderT q backend))
    Nothing -> sqlQuery q
  t1 <- getMonotonicTimeNSec
  modifyIORef' (sqeSqlNanos env) (+ fromIntegral (t1 - t0))
  pure r

-- | Pin (or unpin) the epoch's snapshot connection for this context.
setSnapshot :: SqlQueryEnv -> Maybe (MVar SqlBackend) -> IO ()
setSnapshot = writeIORef . sqeSnapshot

setCacheMaxRows :: SqlQueryEnv -> Int -> IO ()
setCacheMaxRows env n = writeIORef (sqeCacheMaxRows env) (max 1 n)

setPrefetchMaxRows :: SqlQueryEnv -> Int -> IO ()
setPrefetchMaxRows env n = writeIORef (sqePrefetchMaxRows env) (max 0 n)

setPrefetchAfterSlots :: SqlQueryEnv -> Int -> IO ()
setPrefetchAfterSlots env n = writeIORef (sqePrefetchAfterSlots env) (max 0 n)

-- | Sizes of the per-block caches: (storage rows, accounts).
cacheSizes :: SqlQueryEnv -> IO (Int, Int)
cacheSizes env = (,) <$> (M.size <$> readIORef (sqeStorageCache env)) <*> (M.size <$> readIORef (sqeAccounts env))

-- | Drop the caches whole when past the cap. Called before a fill, never
-- between a fill and the read that needed it, so a read always sees what
-- it just loaded; a fill may therefore overshoot the cap by one contract's
-- rows (at most the cap itself, see prefetchStorage), which bounds a
-- context's memory at twice the cap.
enforceCacheCap :: SqlQueryEnv -> IO ()
enforceCacheCap env = do
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
loadBestHeader :: SqlQueryEnv -> IO ()
loadBestHeader env = do
  mBdr <- mirrorQuery env $ P.selectFirst [] [P.Desc BlockDataRefNumber]
  case mBdr of
    Nothing -> hPutStrLn stderr "vm-query: block_data_ref is empty, eth_call has no best block"
    Just (P.Entity _ bdr) -> do
      let header = bdrToHeader bdr
      modifyIORef' (sqeState env) (\s -> s {_bestBlockInfo = ContextBestBlockInfo (blockHeaderHash header) header 0})

bestHeader :: SqlQueryEnv -> IO (Maybe BlockHeader)
bestHeader env = do
  s <- readIORef (sqeState env)
  pure $ case _bestBlockInfo s of
    ContextBestBlockInfo _ h _ -> Just h
    Unspecified -> Nothing

loadAddressState :: SqlQueryEnv -> Address -> IO (Maybe AddressState)
loadAddressState env addr = do
  let ref = sqeAccounts env
  cached <- readIORef ref
  case M.lookup addr cached of
    Just st -> pure st
    Nothing -> do
      enforceCacheCap env
      mRow <- mirrorQuery env $ P.getBy (UniqueAddress addr)
      let st = flip fmap mRow $ \(P.Entity _ r) ->
            AddressState
              { addressStateNonce = addressStateRefNonce r,
                addressStateBalance = addressStateRefBalance r,
                addressStateContractRoot = addressStateRefContractRoot r,
                addressStateCodeHash = fromMaybe (addressStateCodeHash blankAddressState) (addressStateRefCodePtr r),
                addressStateChainId = Nothing
              }
      -- The same row answers the id lookup for storage.
      modifyIORef' ref (M.insert addr st)
      modifyIORef' (sqeAccountIds env) (M.insert addr (P.entityKey <$> mRow))
      pure st

-- | The row id behind an address, once per command.
accountId :: SqlQueryEnv -> Address -> IO (Maybe AddressStateRefId)
accountId env addr = do
  let ref = sqeAccountIds env
  cached <- readIORef ref
  case M.lookup addr cached of
    Just sid -> pure sid
    Nothing -> do
      sid <- fmap P.entityKey <$> mirrorQuery env (P.getBy (UniqueAddress addr))
      modifyIORef' ref (M.insert addr sid)
      pure sid

-- | Whole-contract prefetch: the first slot read of an address with at most
-- 'sqePrefetchMaxRows' rows pulls every row into the cache in one query, and
-- every later slot of that address is a cache hit. Returns the number of
-- rows loaded, or Nothing when the contract is too large for it.
prefetchStorage :: SqlQueryEnv -> Address -> AddressStateRefId -> IO (Maybe Int)
prefetchStorage env addr sid = do
  let ref = sqePrefetched env
  done <- readIORef ref
  cap <- readIORef (sqeCacheMaxRows env)
  prefetchMax <- readIORef (sqePrefetchMaxRows env)
  after <- readIORef (sqePrefetchAfterSlots env)
  case M.lookup addr done of
    Just n | n >= 0 -> pure (Just n)
    -- Too large for the threshold: slot by slot, unless this context has
    -- read enough of its slots this epoch to make one query the cheaper
    -- path, in which case it is prefetched whole up to the cache cap.
    Just slotReads
      | after > 0 && negate slotReads >= after -> do
          r <- fetch ref cap
          when (isJust r) $ incCounter prefetchPromoted
          pure r
      | otherwise -> pure Nothing
    Nothing -> do
      r <- fetch ref (min prefetchMax cap)
      when (isNothing r) $ incCounter prefetchDeclined
      pure r
  where
    fetch ref limit = do
      enforceCacheCap env
      rows <- mirrorQuery env $ P.selectList [StorageAddressStateRefId ==. sid] [P.LimitTo (limit + 1)]
      if length rows > limit
        then do
          modifyIORef' ref (M.insertWith (\_ old -> min old (-1)) addr (-1))
          pure Nothing
        else do
          modifyIORef' (sqeStorageCache env) $ \cache ->
            foldr (\(P.Entity _ st) -> M.insert (addr, storageKey st) (Just (storageValue st))) cache rows
          modifyIORef' ref (M.insert addr (length rows))
          observe prefetchRowsHistogram (fromIntegral (length rows))
          pure (Just (length rows))

loadStorage :: SqlQueryEnv -> Address -> RawStorageKey -> IO (Maybe RawStorageValue)
loadStorage env addr key@(_, path) = do
  let cacheRef = sqeStorageCache env
  cache <- readIORef cacheRef
  case M.lookup key cache of
    Just v -> pure v
    Nothing -> do
      mSid <- accountId env addr
      case mSid of
        Nothing -> pure Nothing
        Just sid -> do
          prefetched <- prefetchStorage env addr sid
          case prefetched of
            -- Everything the contract has is cached now; absent means empty.
            Just _ -> M.findWithDefault Nothing key <$> readIORef cacheRef
            Nothing -> do
              enforceCacheCap env
              rows <- mirrorQuery env $ P.selectList [StorageAddressStateRefId ==. sid, StorageKey ==. path] [P.LimitTo 1]
              let v = case rows of
                    (P.Entity _ st : _) -> Just (storageValue st)
                    [] -> Nothing
              modifyIORef' cacheRef (M.insert key v)
              modifyIORef' (sqePrefetched env) (M.adjust (subtract 1) addr)
              pure v

loadCode :: SqlQueryEnv -> Keccak256 -> IO (Maybe DBCode)
loadCode env h = do
  mRow <- mirrorQuery env $ P.getBy (UniqueCodeHash h)
  pure $ encodeUtf8 . codeRefCode . P.entityVal <$> mRow

headerSummary :: BlockHeader -> BlockSummary
headerSummary header = blockHeaderToBSum (fromIntegral (Conf.chainId (Conf.networkConfig ethConf))) noProposalFacts header 0

-- | A block's summary: the best block's from the header already in hand (the
-- main chain's state root is asked for on every call), any other from the
-- mirror, once.
loadSummary :: SqlQueryEnv -> Keccak256 -> IO (Maybe BlockSummary)
loadSummary env h = do
  best <- bestHeader env
  case best of
    Just header | blockHeaderHash header == h -> pure (Just (headerSummary header))
    _ -> do
      cached <- readIORef (sqeSummaries env)
      case M.lookup h cached of
        Just s -> pure (Just s)
        Nothing -> do
          mBdr <- mirrorQuery env $ P.selectFirst [BlockDataRefHash ==. h] []
          let ms = headerSummary . bdrToHeader . P.entityVal <$> mBdr
          forM_ ms $ \s -> modifyIORef' (sqeSummaries env) (M.insert h s)
          pure ms
