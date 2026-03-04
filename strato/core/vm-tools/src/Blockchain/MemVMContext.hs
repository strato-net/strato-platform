{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
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
    CurrentBlockHash (..),
    GasCap (..),
    MemDBs (..),
    currentBlock,
    debugSettings,
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
import Control.Lens
import Control.Monad (join)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.IO.Class
import Control.Monad.Reader
import qualified Data.ByteString as B
import Data.Default
import qualified Data.Map as M
import Data.Maybe (fromMaybe)
import qualified Data.NibbleString as N
import Data.Traversable (for)
import Debugger
import GHC.Generics
import UnliftIO

data MemContextDBs = MemContextDBs
  { _stateDB :: M.Map MP.StateRoot MP.NodeData,
    _hashDB :: M.Map N.NibbleString N.NibbleString,
    _codeDB :: M.Map Keccak256 DBCode,
    _blockSummaryDB :: M.Map Keccak256 BlockSummary,
    _blockHashRoot :: BlockHashRoot,
    _bestBlockRoot :: BestBlockRoot,
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
        _bestBlockRoot = BestBlockRoot MP.emptyTriePtr,
        _worldBestBlock = Nothing
      }

instance NFData MemContextDBs where
  rnf MemContextDBs {..} =
    _stateDB
      `seq` _hashDB
      `seq` rnf _codeDB
      `seq` _blockSummaryDB
      `seq` rnf _blockHashRoot
      `seq` rnf _bestBlockRoot
      `seq` _worldBestBlock
      `seq` ()

data MemContext = MemContext
  { _dbs :: MemContextDBs,
    _state :: ContextState
  }
  deriving (Generic, NFData)

makeLenses ''MemContext

instance Default MemContext where
  def = MemContext def def

type MemContextM m = ReaderT (IORef MemContext) m

getMemContext :: MonadIO m => MemContextM m MemContext
getMemContext = ask >>= readIORef

get :: MonadIO m => MemContextM m ContextState
get = _state <$> getMemContext
{-# INLINE get #-}

gets :: MonadIO m => (ContextState -> a) -> MemContextM m a
gets f = f <$> get
{-# INLINE gets #-}

put :: MonadIO m => ContextState -> MemContextM m ()
put c = ask >>= \i -> atomicModifyIORef i $ (,()) . (state .~ c)
{-# INLINE put #-}

modify :: MonadIO m => (ContextState -> ContextState) -> MemContextM m ()
modify f = ask >>= \i -> atomicModifyIORef i $ (,()) . (state %~ f)
{-# INLINE modify #-}

modify' :: MonadIO m => (ContextState -> ContextState) -> MemContextM m ()
modify' f = ask >>= \i -> atomicModifyIORef' i $ (,()) . (state %~ f)
{-# INLINE modify' #-}

dbsGet :: MonadIO m => MemContextM m MemContextDBs
dbsGet = _dbs <$> getMemContext
{-# INLINE dbsGet #-}

dbsGets :: MonadIO m => (MemContextDBs -> a) -> MemContextM m a
dbsGets f = f <$> dbsGet
{-# INLINE dbsGets #-}

dbsPut :: MonadIO m => MemContextDBs -> MemContextM m ()
dbsPut c = ask >>= \i -> atomicModifyIORef i $ (,()) . (dbs .~ c)
{-# INLINE dbsPut #-}

dbsModify :: MonadIO m => (MemContextDBs -> MemContextDBs) -> MemContextM m ()
dbsModify f = ask >>= \i -> atomicModifyIORef i $ (,()) . (dbs %~ f)
{-# INLINE dbsModify #-}

dbsModify' :: MonadIO m => (MemContextDBs -> MemContextDBs) -> MemContextM m ()
dbsModify' f = ask >>= \i -> atomicModifyIORef' i $ (,()) . (dbs %~ f)
{-# INLINE dbsModify' #-}

contextGet :: MonadIO m => MemContextM m ContextState
contextGet = get
{-# INLINE contextGet #-}

contextGets :: MonadIO m => (ContextState -> a) -> MemContextM m a
contextGets = gets
{-# INLINE contextGets #-}

contextPut :: MonadIO m => ContextState -> MemContextM m ()
contextPut = put
{-# INLINE contextPut #-}

contextModify :: MonadIO m => (ContextState -> ContextState) -> MemContextM m ()
contextModify = modify
{-# INLINE contextModify #-}

contextModify' :: MonadIO m => (ContextState -> ContextState) -> MemContextM m ()
contextModify' = modify'
{-# INLINE contextModify' #-}

instance Show MemContext where
  show = const "<context>"

instance MonadIO m => Mod.Modifiable ContextState (MemContextM m) where
  get _ = get
  put _ = put

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible MemContext (MemContextM m) where
  access _ = ask >>= readIORef

instance MonadIO m => Mod.Modifiable (Maybe DebugSettings) (MemContextM m) where
  get _ = gets $ view debugSettings
  put _ ds = modify $ debugSettings .~ ds

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible ContextState (MemContextM m) where
  access _ = get

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible MemDBs (MemContextM m) where
  access _ = gets $ view memDBs

instance MonadIO m => Mod.Modifiable MemDBs (MemContextM m) where
  get _ = gets $ view memDBs
  put _ md = modify $ memDBs .~ md

vmBlockHashRootKey :: B.ByteString
vmBlockHashRootKey = "block_hash_root"

vmBestBlockRootKey :: B.ByteString
vmBestBlockRootKey = "best_block_root"

instance MonadIO m => Mod.Modifiable BlockHashRoot (MemContextM m) where
  get _ = dbsGets $ view blockHashRoot
  put _ bhr = dbsModify' $ blockHashRoot .~ bhr

instance MonadIO m => Mod.Modifiable BestBlockRoot (MemContextM m) where
  get _ = dbsGets $ view bestBlockRoot
  put _ bbr = dbsModify' $ bestBlockRoot .~ bbr

instance MonadIO m => Mod.Modifiable CurrentBlockHash (MemContextM m) where
  get _ = fmap (fromMaybe (CurrentBlockHash $ unsafeCreateKeccak256FromWord256 0)) . gets $ view $ memDBs . currentBlock
  put _ bh = modify $ memDBs . currentBlock ?~ bh

instance MonadIO m => HasMemAddressStateDB (MemContextM m) where
  getAddressStateTxDBMap = gets $ view $ memDBs . stateTxMap
  putAddressStateTxDBMap theMap = modify $ memDBs . stateTxMap .~ theMap
  getAddressStateBlockDBMap = gets $ view $ memDBs . stateBlockMap
  putAddressStateBlockDBMap theMap = modify $ memDBs . stateBlockMap .~ theMap

instance MonadIO m => (MP.StateRoot `A.Alters` MP.NodeData) (MemContextM m) where
  lookup _ sr = dbsGets $ view (stateDB . at sr)
  insert _ sr nd = dbsModify' $ stateDB . at sr ?~ nd
  delete _ sr = dbsModify' $ stateDB . at sr .~ Nothing

instance (MonadIO m, MonadLogger m) => (Address `A.Alters` AddressState) (MemContextM m) where
  lookup _ = getAddressStateMaybe
  insert _ = putAddressState
  delete _ = deleteAddressState

instance {-# OVERLAPPING #-} (MonadIO m, MonadLogger m) => A.Selectable Address AddressState (MemContextM m) where
  select _ = getAddressStateMaybe

instance (MonadIO m, MonadLogger m) => (Maybe Word256 `A.Alters` MP.StateRoot) (MemContextM m) where
  lookup _ chainId = do
    mBH <- gets $ view $ memDBs . currentBlock
    fmap join . for mBH $ \(CurrentBlockHash bh) -> do
      mSR <- gets $ view $ memDBs . stateRoots . at (bh, chainId)
      case mSR of
        Just sr -> pure $ Just sr
        Nothing -> getChainStateRoot chainId bh
  insert _ chainId sr = do
    mBH <- gets $ view $ memDBs . currentBlock
    case mBH of
      Nothing -> pure ()
      Just (CurrentBlockHash bh) -> do
        modify $ memDBs . stateRoots %~ M.insert (bh, chainId) sr
        putChainStateRoot chainId bh sr
  delete _ chainId = do
    mBH <- gets $ view $ memDBs . currentBlock
    case mBH of
      Nothing -> pure ()
      Just (CurrentBlockHash bh) -> do
        modify $ memDBs . stateRoots %~ M.delete (bh, chainId)
        deleteChainStateRoot chainId bh

instance MonadIO m => (Keccak256 `A.Alters` DBCode) (MemContextM m) where
  lookup _ k = dbsGets $ view (codeDB . at k)
  insert _ k c = dbsModify' $ codeDB . at k ?~ c
  delete _ k = dbsModify' $ codeDB . at k .~ Nothing

instance MonadIO m => (N.NibbleString `A.Alters` N.NibbleString) (MemContextM m) where
  lookup _ n1 = dbsGets $ view (hashDB . at n1)
  insert _ n1 n2 = dbsModify' $ hashDB . at n1 ?~ n2
  delete _ n1 = dbsModify' $ hashDB . at n1 .~ Nothing

instance MonadIO m => HasMemRawStorageDB (MemContextM m) where
  getMemRawStorageTxDB = gets $ view $ memDBs . storageTxMap
  putMemRawStorageTxMap theMap = modify $ memDBs . storageTxMap .~ theMap
  getMemRawStorageBlockDB = gets $ view $ memDBs . storageBlockMap
  putMemRawStorageBlockMap theMap = modify $ memDBs . storageBlockMap .~ theMap

instance (MonadIO m, MonadLogger m) => (RawStorageKey `A.Alters` RawStorageValue) (MemContextM m) where
  lookup _ = genericLookupRawStorageDB
  insert _ = genericInsertRawStorageDB
  delete _ = genericDeleteRawStorageDB
  lookupWithDefault _ = genericLookupWithDefaultRawStorageDB

instance MonadIO m => (Keccak256 `A.Alters` BlockSummary) (MemContextM m) where
  lookup _ k = dbsGets $ view (blockSummaryDB . at k)
  insert _ k bs = dbsModify' $ blockSummaryDB . at k ?~ bs
  delete _ k = dbsModify' $ blockSummaryDB . at k .~ Nothing

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible (Maybe WorldBestBlock) (MemContextM m) where
  access _ = dbsGets $ view worldBestBlock

instance MonadIO m => Mod.Modifiable GasCap (MemContextM m) where
  get _ = GasCap . _vmGasCap <$> get
  put _ (GasCap g) = contextModify $ vmGasCap .~ g

runMemContextM ::
  (MonadIO m, MonadLogger m) =>
  Maybe DebugSettings ->
  MemContextM m a ->
  m (a, MemContext)
runMemContextM = runMemContextMWith def

runMemContextMWith ::
  (MonadIO m, MonadLogger m) =>
  MemContextDBs ->
  Maybe DebugSettings ->
  MemContextM m a ->
  m (a, MemContext)
runMemContextMWith cdbs dSettings f = do
  cache <- liftIO $ TRC.new 64
  let cstate =
        def
          & txRunResultsCache .~ cache
          & debugSettings .~ dSettings
      ctx = MemContext cdbs cstate
  ctxRef <- newIORef ctx
  a <- flip runReaderT ctxRef $ do
    MP.initializeBlank
    setStateDBStateRoot Nothing MP.emptyTriePtr
    f
  ctx' <- readIORef ctxRef
  return (a, ctx')

evalMemContextM ::
  (MonadIO m, MonadLogger m) =>
  Maybe DebugSettings ->
  MemContextM m a ->
  m a
evalMemContextM d f = fst <$> runMemContextM d f

execMemContextM ::
  (MonadIO m, MonadLogger m) =>
  Maybe DebugSettings ->
  MemContextM m a ->
  m MemContext
execMemContextM d f = snd <$> runMemContextM d f

compactMemContextM :: MonadIO m => MemContextM m ()
compactMemContextM = ask >>= flip atomicModifyIORef' (\a -> (force a, ()))
