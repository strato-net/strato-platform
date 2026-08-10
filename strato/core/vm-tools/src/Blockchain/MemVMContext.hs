{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE KindSignatures #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE StandaloneDeriving #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE UndecidableInstances #-}
{-# OPTIONS -fno-warn-orphans      #-}
{-# OPTIONS_GHC -fno-warn-type-defaults #-}

{-# OPTIONS -fno-warn-deprecations #-}

module Blockchain.MemVMContext
  ( module Blockchain.MemVMContext,
    CurrentBlockHash (..),
    MemDBs (..),
    ContextState (..),
    currentBlock,
    txRunResultsCache,
    debugSettings,
    memDBs,
    stateRoots,
    stateTxMap,
    stateBlockMap,
    storageTxMap,
    storageBlockMap,
  )
where

import BlockApps.Logging
import Blockchain.DB.ChainDB
import Blockchain.DB.CodeDB
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.RawStorageDB
import Blockchain.DB.StateDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.BlockSummary
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Model.SyncState
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import qualified Blockchain.TxRunResultCache as TRC
import Blockchain.VMContext
  ( ContextState (..),
    VMBase,
    CurrentBlockHash (..),
    GasCap (..),
    MemDBs (..),
    currentBlock,
    debugSettings,
    vmTracer,
    memDBs,
    stateBlockMap,
    stateRoots,
    stateTxMap,
    storageBlockMap,
    storageTxMap,
    txRunResultsCache,
    vmGasCap,
  )
import Control.DeepSeq
import Control.Lens hiding (Context)
import Control.Monad.Catch
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.IO.Class
import Control.Monad.Reader
import qualified Data.ByteString as B
import Data.Default
import qualified Data.Map as M
import Data.Maybe (fromMaybe)
import qualified Data.NibbleString as N
import Blockchain.Data.VmTrace (VmTracer)
import Debugger
import GHC.Generics
import UnliftIO

data MemContextDBs = MemContextDBs
  { _stateDB :: M.Map MP.StateRoot MP.NodeData,
    _hashDB :: M.Map N.NibbleString N.NibbleString,
    _codeDB :: M.Map Keccak256 DBCode,
    _blockSummaryDB :: M.Map Keccak256 BlockSummary,
    _blockHashRoot :: BlockHashRoot,
    _worldBestBlock :: Maybe WorldBestBlock
  }
  deriving (Generic)

makeLenses ''MemContextDBs

instance Default MemContextDBs where
  def =
    MemContextDBs
      { _stateDB = M.empty,
        _hashDB = M.empty,
        _codeDB = M.empty,
        _blockSummaryDB = M.empty,
        _blockHashRoot = BlockHashRoot MP.emptyTriePtr,
        _worldBestBlock = Nothing
      }

instance NFData MemContextDBs where
  rnf MemContextDBs {..} =
    _stateDB
      `seq` _hashDB
      `seq` rnf _codeDB
      `seq` _blockSummaryDB
      `seq` rnf _blockHashRoot
      `seq` _worldBestBlock
      `seq` ()

data VMType = InMemory | Sandboxed

data MemContext (t :: VMType) = MemContext
  { _dbs :: MemContextDBs,
    _state :: ContextState
  }
  deriving (Generic, NFData)

makeLenses ''MemContext

instance Default (MemContext t) where
  def = MemContext def def

type MemContextM (t :: VMType) m = ReaderT (IORef (MemContext t)) m

getMemContext :: MonadIO m => MemContextM t m (MemContext t)
getMemContext = ask >>= readIORef

get :: MonadIO m => MemContextM t m ContextState
get = _state <$> getMemContext
{-# INLINE get #-}

gets :: MonadIO m => (ContextState -> a) -> MemContextM t m a
gets f = f <$> get
{-# INLINE gets #-}

put :: MonadIO m => ContextState -> MemContextM t m ()
put c = ask >>= \i -> atomicModifyIORef i $ (,()) . (state .~ c)
{-# INLINE put #-}

modify :: MonadIO m => (ContextState -> ContextState) -> MemContextM t m ()
modify f = ask >>= \i -> atomicModifyIORef i $ (,()) . (state %~ f)
{-# INLINE modify #-}

modify' :: MonadIO m => (ContextState -> ContextState) -> MemContextM t m ()
modify' f = ask >>= \i -> atomicModifyIORef' i $ (,()) . (state %~ f)
{-# INLINE modify' #-}

dbsGet :: MonadIO m => MemContextM t m MemContextDBs
dbsGet = _dbs <$> getMemContext
{-# INLINE dbsGet #-}

dbsGets :: MonadIO m => (MemContextDBs -> a) -> MemContextM t m a
dbsGets f = f <$> dbsGet
{-# INLINE dbsGets #-}

dbsPut :: MonadIO m => MemContextDBs -> MemContextM t m ()
dbsPut c = ask >>= \i -> atomicModifyIORef i $ (,()) . (dbs .~ c)
{-# INLINE dbsPut #-}

dbsModify :: MonadIO m => (MemContextDBs -> MemContextDBs) -> MemContextM t m ()
dbsModify f = ask >>= \i -> atomicModifyIORef i $ (,()) . (dbs %~ f)
{-# INLINE dbsModify #-}

dbsModify' :: MonadIO m => (MemContextDBs -> MemContextDBs) -> MemContextM t m ()
dbsModify' f = ask >>= \i -> atomicModifyIORef' i $ (,()) . (dbs %~ f)
{-# INLINE dbsModify' #-}

contextGet :: MonadIO m => MemContextM t m ContextState
contextGet = get
{-# INLINE contextGet #-}

contextGets :: MonadIO m => (ContextState -> a) -> MemContextM t m a
contextGets = gets
{-# INLINE contextGets #-}

contextPut :: MonadIO m => ContextState -> MemContextM t m ()
contextPut = put
{-# INLINE contextPut #-}

contextModify :: MonadIO m => (ContextState -> ContextState) -> MemContextM t m ()
contextModify = modify
{-# INLINE contextModify #-}

contextModify' :: MonadIO m => (ContextState -> ContextState) -> MemContextM t m ()
contextModify' = modify'
{-# INLINE contextModify' #-}

instance Show (MemContext t) where
  show = const "<context>"

instance MonadIO m => Mod.Modifiable ContextState (MemContextM t m) where
  get _ = get
  put _ = put

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible (MemContext t) (MemContextM t m) where
  access _ = ask >>= readIORef

instance MonadIO m => Mod.Modifiable (Maybe DebugSettings) (MemContextM t m) where
  get _ = gets $ view debugSettings
  put _ ds = modify $ debugSettings .~ ds

instance MonadIO m => Mod.Modifiable (Maybe VmTracer) (MemContextM t m) where
  get _ = gets $ view vmTracer
  put _ t = modify $ vmTracer .~ t

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible ContextState (MemContextM t m) where
  access _ = get

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible MemDBs (MemContextM t m) where
  access _ = gets $ view memDBs

instance MonadIO m => Mod.Modifiable MemDBs (MemContextM t m) where
  get _ = gets $ view memDBs
  put _ md = modify $ memDBs .~ md

vmBlockHashRootKey :: B.ByteString
vmBlockHashRootKey = "block_hash_root"

instance MonadIO m => Mod.Modifiable BlockHashRoot (MemContextM 'InMemory m) where
  get _ = dbsGets $ view blockHashRoot
  put _ bhr = dbsModify' $ blockHashRoot .~ bhr

instance VMBase m => Mod.Modifiable BlockHashRoot (MemContextM 'Sandboxed m) where
  get p = dbsGets (view blockHashRoot) >>= \case
    BlockHashRoot bh | bh == MP.emptyTriePtr -> lift $ Mod.get p
    bh -> pure bh
  put _ bhr = dbsModify' $ blockHashRoot .~ bhr

instance MonadIO m => Mod.Modifiable CurrentBlockHash (MemContextM 'InMemory m) where
  get _ = fmap (fromMaybe (CurrentBlockHash $ unsafeCreateKeccak256FromWord256 0)) . gets $ view $ memDBs . currentBlock
  put _ bh = modify $ memDBs . currentBlock ?~ bh

instance VMBase m => Mod.Modifiable CurrentBlockHash (MemContextM 'Sandboxed m) where
  get p = gets (view $ memDBs . currentBlock) >>= \case
    Just a -> pure a
    Nothing -> lift $ Mod.get p
  put _ bh = modify $ memDBs . currentBlock ?~ bh

instance MonadIO m => HasMemAddressStateDB (MemContextM t m) where
  getAddressStateTxDBMap = gets $ view $ memDBs . stateTxMap
  putAddressStateTxDBMap theMap = modify $ memDBs . stateTxMap .~ theMap
  getAddressStateBlockDBMap = gets $ view $ memDBs . stateBlockMap
  putAddressStateBlockDBMap theMap = modify $ memDBs . stateBlockMap .~ theMap

instance MonadIO m => (MP.StateRoot `A.Alters` MP.NodeData) (MemContextM 'InMemory m) where
  lookup _ sr = dbsGets $ view (stateDB . at sr)
  insert _ sr nd = dbsModify' $ stateDB . at sr ?~ nd
  delete _ sr = dbsModify' $ stateDB . at sr .~ Nothing

instance VMBase m => (MP.StateRoot `A.Alters` MP.NodeData) (MemContextM 'Sandboxed m) where
  lookup p sr = dbsGets (view $ stateDB . at sr) >>= \case
    Just a -> pure $ Just a
    Nothing -> lift $ A.lookup p sr
  insert _ sr nd = dbsModify' $ stateDB . at sr ?~ nd
  delete _ sr = dbsModify' $ stateDB . at sr .~ Nothing

instance VMBase (MemContextM t m) => (Address `A.Alters` AddressState) (MemContextM t m) where
  lookup _ = getAddressStateMaybe
  insert _ = putAddressState
  delete _ = deleteAddressState

instance {-# OVERLAPPING #-} VMBase (MemContextM t m) => A.Selectable Address AddressState (MemContextM t m) where
  select _ = getAddressStateMaybe

instance (MonadIO m, VMBase (MemContextM t m)) => (Maybe Word256 `A.Alters` MP.StateRoot) (MemContextM t m) where
  lookup _ chainId = Mod.get (Mod.Proxy @CurrentBlockHash) >>= \(CurrentBlockHash bh) -> do
    mSR <- gets $ view $ memDBs . stateRoots . at (bh, chainId)
    case mSR of
      Just sr -> pure $ Just sr
      Nothing -> getChainStateRoot chainId bh
  insert _ chainId sr = Mod.get (Mod.Proxy @CurrentBlockHash) >>= \(CurrentBlockHash bh) -> do
    modify $ memDBs . stateRoots %~ M.insert (bh, chainId) sr
    putChainStateRoot chainId bh sr
  delete _ chainId = Mod.get (Mod.Proxy @CurrentBlockHash) >>= \(CurrentBlockHash bh) -> do
    modify $ memDBs . stateRoots %~ M.delete (bh, chainId)
    deleteChainStateRoot chainId bh

instance MonadIO m => (Keccak256 `A.Alters` DBCode) (MemContextM 'InMemory m) where
  lookup _ k = dbsGets $ view (codeDB . at k)
  insert _ k c = dbsModify' $ codeDB . at k ?~ c
  delete _ k = dbsModify' $ codeDB . at k .~ Nothing

instance VMBase m => (Keccak256 `A.Alters` DBCode) (MemContextM 'Sandboxed m) where
  lookup p k = dbsGets (view $ codeDB . at k) >>= \case
    Just a -> pure $ Just a
    Nothing -> lift $ A.lookup p k
  insert _ k c = dbsModify' $ codeDB . at k ?~ c
  delete _ k = dbsModify' $ codeDB . at k .~ Nothing

instance MonadIO m => (N.NibbleString `A.Alters` N.NibbleString) (MemContextM 'InMemory m) where
  lookup _ n1 = dbsGets $ view (hashDB . at n1)
  insert _ n1 n2 = dbsModify' $ hashDB . at n1 ?~ n2
  delete _ n1 = dbsModify' $ hashDB . at n1 .~ Nothing

instance VMBase m => (N.NibbleString `A.Alters` N.NibbleString) (MemContextM 'Sandboxed m) where
  lookup p n1 = dbsGets (view $ hashDB . at n1) >>= \case
    Just a -> pure $ Just a
    Nothing -> lift $ A.lookup p n1
  insert _ n1 n2 = dbsModify' $ hashDB . at n1 ?~ n2
  delete _ n1 = dbsModify' $ hashDB . at n1 .~ Nothing

instance MonadIO m => HasMemRawStorageDB (MemContextM t m) where
  getMemRawStorageTxDB = gets $ view $ memDBs . storageTxMap
  putMemRawStorageTxMap theMap = modify $ memDBs . storageTxMap .~ theMap
  getMemRawStorageBlockDB = gets $ view $ memDBs . storageBlockMap
  putMemRawStorageBlockMap theMap = modify $ memDBs . storageBlockMap .~ theMap

instance VMBase (MemContextM t m) => (RawStorageKey `A.Alters` RawStorageValue) (MemContextM t m) where
  lookup _ = genericLookupRawStorageDB
  insert _ = genericInsertRawStorageDB
  delete _ = genericDeleteRawStorageDB
  lookupWithDefault _ = genericLookupWithDefaultRawStorageDB

instance MonadIO m => (Keccak256 `A.Alters` BlockSummary) (MemContextM 'InMemory m) where
  lookup _ k = dbsGets $ view (blockSummaryDB . at k)
  insert _ k bs = dbsModify' $ blockSummaryDB . at k ?~ bs
  delete _ k = dbsModify' $ blockSummaryDB . at k .~ Nothing

instance VMBase m => (Keccak256 `A.Alters` BlockSummary) (MemContextM 'Sandboxed m) where
  lookup p k = dbsGets (view $ blockSummaryDB . at k) >>= \case
    Just a -> pure $ Just a
    Nothing -> lift $ A.lookup p k
  insert _ k bs = dbsModify' $ blockSummaryDB . at k ?~ bs
  delete _ k = dbsModify' $ blockSummaryDB . at k .~ Nothing

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible (Maybe WorldBestBlock) (MemContextM 'InMemory m) where
  access _ = dbsGets $ view worldBestBlock

instance VMBase m => Mod.Accessible (Maybe WorldBestBlock) (MemContextM 'Sandboxed m) where
  access _ = dbsGets $ view worldBestBlock

instance MonadIO m => Mod.Modifiable GasCap (MemContextM t m) where
  get _ = GasCap . _vmGasCap <$> get
  put _ (GasCap g) = contextModify $ vmGasCap .~ g

runMemContextM ::
  (MonadUnliftIO m, MonadLogger m, MonadCatch m, A.Selectable FilePath (Either String String) m) =>
  Maybe DebugSettings ->
  MemContextM 'InMemory m a ->
  m (a, MemContext 'InMemory)
runMemContextM d f = do
  let initialize = do
        MP.initializeBlank
        setStateDBStateRoot Nothing MP.emptyTriePtr
  runMemContextMWith def d (initialize >> f)

runMemContextMWith ::
  MonadUnliftIO m =>
  MemContextDBs ->
  Maybe DebugSettings ->
  MemContextM t m a ->
  m (a, MemContext t)
runMemContextMWith cdbs dSettings f = do
  cache <- liftIO $ TRC.new 64
  let cstate =
        def
          & txRunResultsCache .~ cache
          & debugSettings .~ dSettings
  runMemContextMWith' cdbs cstate f

runMemContextMWith' ::
  MonadUnliftIO m =>
  MemContextDBs ->
  ContextState ->
  MemContextM t m a ->
  m (a, MemContext t)
runMemContextMWith' cdbs cstate f = do
  let ctx = MemContext cdbs cstate
  ctxRef <- newIORef ctx
  a <- runReaderT f ctxRef
  ctx' <- readIORef ctxRef
  return (a, ctx')

evalMemContextM ::
  (MonadUnliftIO m, MonadLogger m, MonadCatch m, A.Selectable FilePath (Either String String) m) =>
  Maybe DebugSettings ->
  MemContextM 'InMemory m a ->
  m a
evalMemContextM d f = fst <$> runMemContextM d f

execMemContextM ::
  (MonadUnliftIO m, MonadLogger m, MonadCatch m, A.Selectable FilePath (Either String String) m) =>
  Maybe DebugSettings ->
  MemContextM 'InMemory m a ->
  m (MemContext 'InMemory)
execMemContextM d f = snd <$> runMemContextM d f

compactMemContextM :: MonadIO m => MemContextM t m ()
compactMemContextM = ask >>= flip atomicModifyIORef' (\a -> (force a, ()))

evalSandboxedContextM ::
  VMBase m =>
  MemContextM 'Sandboxed m a ->
  m a
evalSandboxedContextM f = do
  cstate <- Mod.access (Mod.Proxy @ContextState)
  fst <$> runMemContextMWith' def cstate f