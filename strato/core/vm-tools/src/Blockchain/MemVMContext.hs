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
import BlockApps.X509.Certificate
import Blockchain.DB.ChainDB
import Blockchain.DB.CodeDB
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.RawStorageDB
import Blockchain.DB.StateDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.Block
import Blockchain.Data.BlockSummary
import Blockchain.Data.ChainInfo
import Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Strato.Model.Account
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
    lookupX509AddrFromCBHash,
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
import Data.Either.Extra
import qualified Data.Map as M
import Data.Maybe (fromMaybe)
import qualified Data.NibbleString as N
import qualified Data.Text as T
import qualified Data.Text.Encoding as Text
import Data.Traversable (for)
import Debugger
import GHC.Generics
import SolidVM.Model.Storable
import Text.Read (readMaybe)
import UnliftIO

data MemContextDBs = MemContextDBs
  { _stateDB :: M.Map MP.StateRoot MP.NodeData,
    _hashDB :: M.Map N.NibbleString N.NibbleString,
    _codeDB :: M.Map Keccak256 DBCode,
    _blockSummaryDB :: M.Map Keccak256 BlockSummary,
    _blockHashRoot :: BlockHashRoot,
    _genesisRoot :: GenesisRoot,
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
        _genesisRoot = GenesisRoot MP.emptyTriePtr,
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
      `seq` rnf _genesisRoot
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

type MemContextM = ReaderT (IORef MemContext) (LoggingT IO) -- I hope we can get rid of the IO dependency someday

getMemContext :: MemContextM MemContext
getMemContext = ask >>= readIORef

get :: MemContextM ContextState
get = _state <$> getMemContext
{-# INLINE get #-}

gets :: (ContextState -> a) -> MemContextM a
gets f = f <$> get
{-# INLINE gets #-}

put :: ContextState -> MemContextM ()
put c = ask >>= \i -> atomicModifyIORef i $ (,()) . (state .~ c)
{-# INLINE put #-}

modify :: (ContextState -> ContextState) -> MemContextM ()
modify f = ask >>= \i -> atomicModifyIORef i $ (,()) . (state %~ f)
{-# INLINE modify #-}

modify' :: (ContextState -> ContextState) -> MemContextM ()
modify' f = ask >>= \i -> atomicModifyIORef' i $ (,()) . (state %~ f)
{-# INLINE modify' #-}

dbsGet :: MemContextM MemContextDBs
dbsGet = _dbs <$> getMemContext
{-# INLINE dbsGet #-}

dbsGets :: (MemContextDBs -> a) -> MemContextM a
dbsGets f = f <$> dbsGet
{-# INLINE dbsGets #-}

dbsPut :: MemContextDBs -> MemContextM ()
dbsPut c = ask >>= \i -> atomicModifyIORef i $ (,()) . (dbs .~ c)
{-# INLINE dbsPut #-}

dbsModify :: (MemContextDBs -> MemContextDBs) -> MemContextM ()
dbsModify f = ask >>= \i -> atomicModifyIORef i $ (,()) . (dbs %~ f)
{-# INLINE dbsModify #-}

dbsModify' :: (MemContextDBs -> MemContextDBs) -> MemContextM ()
dbsModify' f = ask >>= \i -> atomicModifyIORef' i $ (,()) . (dbs %~ f)
{-# INLINE dbsModify' #-}

contextGet :: MemContextM ContextState
contextGet = get
{-# INLINE contextGet #-}

contextGets :: (ContextState -> a) -> MemContextM a
contextGets = gets
{-# INLINE contextGets #-}

contextPut :: ContextState -> MemContextM ()
contextPut = put
{-# INLINE contextPut #-}

contextModify :: (ContextState -> ContextState) -> MemContextM ()
contextModify = modify
{-# INLINE contextModify #-}

contextModify' :: (ContextState -> ContextState) -> MemContextM ()
contextModify' = modify'
{-# INLINE contextModify' #-}

instance Show MemContext where
  show = const "<context>"

instance Mod.Modifiable ContextState MemContextM where
  get _ = get
  put _ = put

instance Mod.Accessible MemContext MemContextM where
  access _ = ask >>= readIORef

instance Mod.Modifiable (Maybe DebugSettings) MemContextM where
  get _ = gets $ view debugSettings
  put _ ds = modify $ debugSettings .~ ds

instance Mod.Accessible ContextState MemContextM where
  access _ = get

instance Mod.Accessible MemDBs MemContextM where
  access _ = gets $ view memDBs

instance Mod.Modifiable MemDBs MemContextM where
  get _ = gets $ view memDBs
  put _ md = modify $ memDBs .~ md

vmBlockHashRootKey :: B.ByteString
vmBlockHashRootKey = "block_hash_root"

vmGenesisRootKey :: B.ByteString
vmGenesisRootKey = "genesis_root"

vmBestBlockRootKey :: B.ByteString
vmBestBlockRootKey = "best_block_root"

instance Mod.Modifiable BlockHashRoot MemContextM where
  get _ = dbsGets $ view blockHashRoot
  put _ bhr = dbsModify' $ blockHashRoot .~ bhr

instance Mod.Modifiable GenesisRoot MemContextM where
  get _ = dbsGets $ view genesisRoot
  put _ gr = dbsModify' $ genesisRoot .~ gr

instance Mod.Modifiable BestBlockRoot MemContextM where
  get _ = dbsGets $ view bestBlockRoot
  put _ bbr = dbsModify' $ bestBlockRoot .~ bbr

instance Mod.Modifiable CurrentBlockHash MemContextM where
  get _ = fmap (fromMaybe (CurrentBlockHash $ unsafeCreateKeccak256FromWord256 0)) . gets $ view $ memDBs . currentBlock
  put _ bh = modify $ memDBs . currentBlock ?~ bh

instance HasMemAddressStateDB MemContextM where
  getAddressStateTxDBMap = gets $ view $ memDBs . stateTxMap
  putAddressStateTxDBMap theMap = modify $ memDBs . stateTxMap .~ theMap
  getAddressStateBlockDBMap = gets $ view $ memDBs . stateBlockMap
  putAddressStateBlockDBMap theMap = modify $ memDBs . stateBlockMap .~ theMap

instance (MP.StateRoot `A.Alters` MP.NodeData) MemContextM where
  lookup _ sr = dbsGets $ view (stateDB . at sr)
  insert _ sr nd = dbsModify' $ stateDB . at sr ?~ nd
  delete _ sr = dbsModify' $ stateDB . at sr .~ Nothing

instance (Account `A.Alters` AddressState) MemContextM where
  lookup _ = getAddressStateMaybe
  insert _ = putAddressState
  delete _ = deleteAddressState

instance A.Selectable Account AddressState MemContextM where
  select _ = getAddressStateMaybe

instance (Maybe Word256 `A.Alters` MP.StateRoot) MemContextM where
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

instance A.Selectable Word256 ParentChainIds MemContextM where
  select _ chainId = fmap (\(_, _, p) -> ParentChainIds p) <$> getChainGenesisInfo (Just chainId)

instance (Keccak256 `A.Alters` DBCode) MemContextM where
  lookup _ k = dbsGets $ view (codeDB . at k)
  insert _ k c = dbsModify' $ codeDB . at k ?~ c
  delete _ k = dbsModify' $ codeDB . at k .~ Nothing

instance ((Address, T.Text) `A.Selectable` X509CertificateField) MemContextM where
  select _ (k, t) = do
    let certKey addr = ((Account addr Nothing),) . Text.encodeUtf8
    mCertAddress <- lookupX509AddrFromCBHash k
    fmap join . for mCertAddress $ \certAddress ->
      maybe Nothing (readMaybe . T.unpack . Text.decodeUtf8) <$> A.lookup (A.Proxy) (certKey certAddress t)

instance (Address `A.Selectable` X509Certificate) MemContextM where
  select _ k = do
    let certKey addr = ((Account addr Nothing),) . Text.encodeUtf8
    mCertAddress <- lookupX509AddrFromCBHash k
    fmap join . for mCertAddress $ \certAddress -> do
      mBString <- fmap (rlpDecode . rlpDeserialize) <$> A.lookup (A.Proxy) (certKey certAddress ".certificateString")
      case mBString of
        Just (BString bs) -> pure . eitherToMaybe $ bsToCert bs
        _ -> pure Nothing

instance (N.NibbleString `A.Alters` N.NibbleString) MemContextM where
  lookup _ n1 = dbsGets $ view (hashDB . at n1)
  insert _ n1 n2 = dbsModify' $ hashDB . at n1 ?~ n2
  delete _ n1 = dbsModify' $ hashDB . at n1 .~ Nothing

instance HasMemRawStorageDB MemContextM where
  getMemRawStorageTxDB = gets $ view $ memDBs . storageTxMap
  putMemRawStorageTxMap theMap = modify $ memDBs . storageTxMap .~ theMap
  getMemRawStorageBlockDB = gets $ view $ memDBs . storageBlockMap
  putMemRawStorageBlockMap theMap = modify $ memDBs . storageBlockMap .~ theMap

instance (RawStorageKey `A.Alters` RawStorageValue) MemContextM where
  lookup _ = genericLookupRawStorageDB
  insert _ = genericInsertRawStorageDB
  delete _ = genericDeleteRawStorageDB
  lookupWithDefault _ = genericLookupWithDefaultRawStorageDB

instance (Keccak256 `A.Alters` BlockSummary) MemContextM where
  lookup _ k = dbsGets $ view (blockSummaryDB . at k)
  insert _ k bs = dbsModify' $ blockSummaryDB . at k ?~ bs
  delete _ k = dbsModify' $ blockSummaryDB . at k .~ Nothing

instance Mod.Accessible (Maybe WorldBestBlock) MemContextM where
  access _ = dbsGets $ view worldBestBlock

instance Mod.Modifiable GasCap MemContextM where
  get _ = GasCap . _vmGasCap <$> get
  put _ (GasCap g) = contextModify $ vmGasCap .~ g

runMemContextM ::
  Maybe DebugSettings ->
  MemContextM a ->
  LoggingT IO (a, MemContext)
runMemContextM = runMemContextMWith def

runMemContextMWith ::
  MemContextDBs ->
  Maybe DebugSettings ->
  MemContextM a ->
  LoggingT IO (a, MemContext)
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
  Maybe DebugSettings ->
  MemContextM a ->
  LoggingT IO a
evalMemContextM d f = fst <$> runMemContextM d f

execMemContextM ::
  Maybe DebugSettings ->
  MemContextM a ->
  LoggingT IO MemContext
execMemContextM d f = snd <$> runMemContextM d f

compactMemContextM :: MemContextM ()
compactMemContextM = ask >>= flip atomicModifyIORef' (\a -> (force a, ()))
