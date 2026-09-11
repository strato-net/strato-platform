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
    readRoundTrips,
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
import Control.Monad.IO.Unlift (MonadUnliftIO)
import Control.Monad.Logger
import Control.Monad.Reader
import Data.Foldable (forM_)
import Data.Default (def)
import Data.IORef
import qualified Data.Map.Strict as M
import Data.Maybe (fromMaybe)
import qualified Data.NibbleString as N
import qualified Data.Text as T
import Data.Text.Encoding (encodeUtf8)
import Database.Persist ((==.))
import qualified Database.Persist as P
import Debugger (DebugSettings)
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
    sqePrefetched :: IORef (M.Map Address Int),
    -- | Account rows read during this command; the handlers read the same
    -- account several times per call (resolution, then execution).
    sqeAccounts :: IORef (M.Map Address (Maybe AddressState))
  }

-- | Contracts with at most this many storage rows are read in one query on
-- their first slot access; larger ones are read slot by slot.
prefetchLimit :: Int
prefetchLimit = 4096

newtype SqlQueryM a = SqlQueryM {unSqlQueryM :: ReaderT SqlQueryEnv (LoggingT IO) a}
  deriving (Functor, Applicative, Monad, MonadIO, MonadReader SqlQueryEnv, MonadLogger, MonadLoggerIO, MonadThrow, MonadCatch, MonadMask, MonadUnliftIO)

runSqlQueryM :: SqlQueryEnv -> SqlQueryM a -> IO a
runSqlQueryM env m = runStderrLoggingT . filterLogger (\_ lvl -> lvl >= LevelWarn) $ runReaderT (unSqlQueryM m) env

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
  let env = SqlQueryEnv db stateRef bhr code sums trips emptyReads ids pre accts
  forM_ mHeader $ \header ->
    modifyIORef' stateRef (\s -> s {_bestBlockInfo = ContextBestBlockInfo (blockHeaderHash header) header 0})
  pure env

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
  act

readRoundTrips :: SqlQueryM Int
readRoundTrips = asks sqeRoundTrips >>= liftIO . readIORef

readEmptyTrieReads :: SqlQueryM Int
readEmptyTrieReads = asks sqeEmptyTrieReads >>= liftIO . readIORef

resetRoundTrips :: SqlQueryM ()
resetRoundTrips = asks sqeRoundTrips >>= liftIO . flip writeIORef 0

countTrip :: SqlQueryM ()
countTrip = asks sqeRoundTrips >>= liftIO . flip modifyIORef' (+ 1)

-- --- SQL reads ---

bdrToHeader :: BlockDataRef -> BlockHeader
bdrToHeader bdr = blockBlockData (blockDataRefToBlock bdr [] [] [] [] [] [])

-- | The highest block the mirror holds becomes the context's best block.
loadBestHeader :: SqlQueryM ()
loadBestHeader = do
  countTrip
  mBdr <- sqlQuery $ P.selectFirst [] [P.Desc BlockDataRefNumber]
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
      countTrip
      mRow <- sqlQuery $ P.getBy (UniqueAddress addr)
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
      countTrip
      sid <- fmap P.entityKey <$> sqlQuery (P.getBy (UniqueAddress addr))
      liftIO $ modifyIORef' ref (M.insert addr sid)
      pure sid

-- | Whole-contract prefetch: the first slot read of an address with at most
-- 'prefetchLimit' rows pulls every row into the overlay in one query, and
-- every later slot of that address is an overlay hit. Returns the number of
-- rows loaded, or Nothing when the contract is too large for it.
prefetchStorage :: Address -> AddressStateRefId -> SqlQueryM (Maybe Int)
prefetchStorage addr sid = do
  ref <- asks sqePrefetched
  done <- liftIO $ readIORef ref
  case M.lookup addr done of
    Just n -> pure (Just n)
    Nothing -> do
      countTrip
      rows <- sqlQuery $ P.selectList [StorageAddressStateRefId ==. sid] [P.LimitTo (prefetchLimit + 1)]
      if length rows > prefetchLimit
        then pure Nothing
        else do
          txMap <- getMemRawStorageTxDB
          putMemRawStorageTxMap $ foldr (\(P.Entity _ st) -> M.insert (addr, storageKey st) (storageValue st)) txMap rows
          liftIO $ modifyIORef' ref (M.insert addr (length rows))
          pure (Just (length rows))

loadStorage :: Address -> RawStorageKey -> SqlQueryM (Maybe RawStorageValue)
loadStorage addr (_, path) = do
  mSid <- accountId addr
  case mSid of
    Nothing -> pure Nothing
    Just sid -> do
      prefetched <- prefetchStorage addr sid
      case prefetched of
        Just _ -> do
          -- Everything the contract has is in the overlay now; absent means empty.
          txMap <- getMemRawStorageTxDB
          pure (M.lookup (addr, path) txMap)
        Nothing -> do
          countTrip
          rows <- sqlQuery $ P.selectList [StorageAddressStateRefId ==. sid, StorageKey ==. path] [P.LimitTo 1]
          pure $ case rows of
            (P.Entity _ st : _) -> Just (storageValue st)
            [] -> Nothing

loadCode :: Keccak256 -> SqlQueryM (Maybe DBCode)
loadCode h = do
  countTrip
  mRow <- sqlQuery $ P.getBy (UniqueCodeHash h)
  pure $ encodeUtf8 . codeRefCode . P.entityVal <$> mRow

loadSummary :: Keccak256 -> SqlQueryM (Maybe BlockSummary)
loadSummary h = do
  countTrip
  mBdr <- sqlQuery $ P.selectFirst [BlockDataRefHash ==. h] []
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
          Nothing -> do
            mv <- loadStorage (fst key) key
            let v = fromMaybe BDefault mv
            -- loadStorage may have prefetched the contract into the overlay:
            -- re-read the map rather than writing back the one from above.
            tx' <- getMemRawStorageTxDB
            putMemRawStorageTxMap (M.insert key v tx')
            pure (Just v)
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
