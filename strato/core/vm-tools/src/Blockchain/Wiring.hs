{-# LANGUAGE RankNTypes #-}
{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE UndecidableInstances #-}

{-# OPTIONS -fno-warn-orphans      #-}

module Blockchain.Wiring
  ( HasContext,
    contextGet,
    contextGets,
    contextModify',
    contextPut,
    compactContextM,
    gets
  )
where

import BlockApps.Init ()
import BlockApps.Logging
import Blockchain.Bagger.BaggerState (BaggerState)
import Blockchain.DB.BlockSummaryDB
import Blockchain.DB.ChainDB
import Blockchain.DB.CodeDB
import Blockchain.DB.HashDB
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.RawStorageDB
import Blockchain.DB.SQLDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.BlockSummary
import Blockchain.Data.DataDefs
import Blockchain.Stream.VMEvent (VMEvent(..), produceVMEvents)
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.CodePtr ()
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Strato.RedisBlockDB as RBDB
import qualified Blockchain.TxRunResultCache as TRC
import Blockchain.VMContext
import Control.DeepSeq
import Control.Lens hiding (Context (..))
import Control.Monad (join, void)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Base
import Control.Monad.Composable.Streaming
import Control.Applicative ((<|>))
import Data.Foldable (for_)
import Control.Monad.IO.Class
import qualified Data.ByteString as B
import Data.Default
import qualified Data.Map as M
import Data.Maybe (fromMaybe)
import qualified Data.NibbleString as N
import qualified Data.Text as T
import Data.Traversable (for)
import qualified Database.LevelDB as DB
import Blockchain.Data.VmTrace (VmTracer)
import Debugger
import UnliftIO

type HasContext m = (Monad m, MonadIO m, AccessibleEnv Context m)

getBackend :: ContextM Backend
getBackend = _backend <$> accessEnv
{-# INLINE getBackend #-}

-- | The persistent stores; absent in 'Memory' mode.
getDBs :: ContextM ContextDBs
getDBs = getBackend >>= \case
  Persistent d -> pure d
  Sandbox _ d -> pure d
  Memory _ -> error "ContextM: no persistent stores in memory mode"

-- | Overlay first, then the persistent store on a miss.
readStore ::
  Ord k =>
  Lens' MemContextDBs (M.Map k v) ->
  (ContextDBs -> ContextM (Maybe v)) ->
  k ->
  ContextM (Maybe v)
readStore l disk k = getBackend >>= \case
  Persistent d -> disk d
  Memory o -> M.lookup k . view l <$> readIORef o
  Sandbox o d -> M.lookup k . view l <$> readIORef o >>= maybe (disk d) (pure . Just)
{-# INLINE readStore #-}

-- | Writes stay in the overlay when there is one.
writeStore ::
  Ord k =>
  Lens' MemContextDBs (M.Map k v) ->
  (ContextDBs -> ContextM ()) ->
  k ->
  Maybe v ->
  ContextM ()
writeStore l disk k mv = getBackend >>= \case
  Persistent d -> disk d
  Memory o -> modifyIORef' o $ l . at k .~ mv
  Sandbox o _ -> modifyIORef' o $ l . at k .~ mv
{-# INLINE writeStore #-}

get :: HasContext m => m ContextState
get = readIORef =<< fmap _state accessEnv
{-# INLINE get #-}

gets :: HasContext m => (ContextState -> a) -> m a
gets f = f <$> get
{-# INLINE gets #-}

put :: HasContext m => ContextState -> m ()
put c = fmap _state accessEnv >>= \i -> atomicModifyIORef' i (const (c, ()))
{-# INLINE put #-}

modify :: HasContext m => (ContextState -> ContextState) -> m ()
modify f = fmap _state accessEnv >>= \i -> atomicModifyIORef' i (\a -> (f a, ()))
{-# INLINE modify #-}

modify' :: HasContext m => (ContextState -> ContextState) -> m ()
modify' f = fmap _state accessEnv >>= \i -> atomicModifyIORef' i (\a -> (f a, ()))
{-# INLINE modify' #-}

contextGet :: HasContext m => m ContextState
contextGet = get
{-# INLINE contextGet #-}

contextGets :: HasContext m => (ContextState -> a) -> m a
contextGets = gets
{-# INLINE contextGets #-}

contextPut :: HasContext m => ContextState -> m ()
contextPut = put
{-# INLINE contextPut #-}

contextModify :: HasContext m => (ContextState -> ContextState) -> m ()
contextModify = modify
{-# INLINE contextModify #-}

contextModify' :: HasContext m => (ContextState -> ContextState) -> m ()
contextModify' = modify'
{-# INLINE contextModify' #-}

compactContextM :: HasContext m => m ()
compactContextM = modify' force


instance Mod.Modifiable ContextState ContextM where
  get _ = get
  put _ = put

instance Mod.Modifiable (Maybe DebugSettings) ContextM where
  get _ = gets $ view debugSettings
  put _ ds = modify $ debugSettings .~ ds

instance Mod.Modifiable (Maybe VmTracer) ContextM where
  get _ = gets $ view vmTracer
  put _ t = modify $ vmTracer .~ t

instance Mod.Accessible ContextState ContextM where
  access _ = get

instance Mod.Modifiable MemDBs ContextM where
  get _ = gets $ view memDBs
  put _ md = modify $ memDBs .~ md

instance Mod.Modifiable BaggerState ContextM where
  get _ = contextGets _baggerState
  put _ s = contextModify $ baggerState .~ s

instance Mod.Accessible TRC.Cache ContextM where
  access _ = contextGets _txRunResultsCache

instance {-# OVERLAPPING #-} HasStreaming m => m `Mod.Yields` TransactionResult where
  yield tr = void $ produceVMEvents [NewTransactionResult tr]

vmBlockHashRootKey :: B.ByteString
vmBlockHashRootKey = "block_hash_root"

instance Mod.Modifiable BlockHashRoot ContextM where
  get _ = getBackend >>= \case
    Persistent d -> disk d
    Memory o -> _memBlockHashRoot <$> readIORef o
    Sandbox o d -> readIORef o >>= \m -> case _memBlockHashRoot m of
      BlockHashRoot bh | bh == MP.emptyTriePtr -> disk d
      bhr -> pure bhr
    where
      disk d = BlockHashRoot . maybe MP.emptyTriePtr MP.StateRoot <$> DB.get (MP.unStateDB $ _stateDB d) def vmBlockHashRootKey
  put _ bhr@(BlockHashRoot (MP.StateRoot sr)) = getBackend >>= \case
    Persistent d -> DB.put (MP.unStateDB $ _stateDB d) def vmBlockHashRootKey sr
    Memory o -> modifyIORef' o $ memBlockHashRoot .~ bhr
    Sandbox o _ -> modifyIORef' o $ memBlockHashRoot .~ bhr

instance Mod.Modifiable CurrentBlockHash ContextM where
  get _ = fmap (fromMaybe (CurrentBlockHash $ unsafeCreateKeccak256FromWord256 0)) . gets $ view $ memDBs . currentBlock
  put _ bh = modify $ memDBs . currentBlock ?~ bh

instance HasMemAddressStateDB ContextM where
  getAddressStateTxDBMap = gets $ view $ memDBs . stateTxMap
  putAddressStateTxDBMap theMap = modify $ memDBs . stateTxMap .~ theMap
  getAddressStateBlockDBMap = gets $ view $ memDBs . stateBlockMap
  putAddressStateBlockDBMap theMap = modify $ memDBs . stateBlockMap .~ theMap

instance (MP.StateRoot `A.Alters` MP.NodeData) ContextM where
  lookup _ k = do
    mnd <- readStore memStateDB (\d -> MP.genericLookupDB (pure . MP.unStateDB $ _stateDB d) k) k
    case mnd of
      Nothing -> accessEnv >>= \ctx -> if _fetchMissingNodes ctx then fetchMPNode k else pure Nothing
      _ -> pure mnd
  insert _ k v = writeStore memStateDB (\d -> MP.genericInsertDB (pure . MP.unStateDB $ _stateDB d) k v) k (Just v)
  delete _ k = writeStore memStateDB (\d -> MP.genericDeleteDB (pure . MP.unStateDB $ _stateDB d) k) k Nothing

-- | Ask peers for a node missing locally and wait (up to 10s) for the reply
-- on the VM's own task topic; used only while diagnosing a state-root mismatch.
fetchMPNode :: MP.StateRoot -> ContextM (Maybe MP.NodeData)
fetchMPNode k = do
  void $ writeUnseqEvents [IEGetMPNodes [k]]
  fmap (Just . fromMaybe MP.EmptyNodeData) . timeout 10000000 $
    runConsume "ethereum-vm" seqVmTasksTopicName $ \evs -> do
      let findND (VmMPNodesReceived [nd]) | k == MP.sha2StateRoot (rlpHash nd) = Just nd
          findND _ = Nothing
          mND = foldr (<|>) Nothing (findND <$> evs)
      for_ mND $ A.insert (A.Proxy @MP.NodeData) k
      pure mND

instance A.Selectable Address AddressState ContextM where
  select _ = getAddressStateMaybe

instance (Address `A.Alters` AddressState) ContextM where
  lookup _ = getAddressStateMaybe
  insert _ = putAddressState
  delete _ = deleteAddressState

instance (Maybe Word256 `A.Alters` MP.StateRoot) ContextM where
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
  delete _ chainId = do
    mBH <- gets $ view $ memDBs . currentBlock
    case mBH of
      Nothing -> pure ()
      Just (CurrentBlockHash bh) -> do
        modify $ memDBs . stateRoots %~ M.delete (bh, chainId)
        deleteChainStateRoot chainId bh

instance (Keccak256 `A.Alters` DBCode) ContextM where
  lookup _ k = readStore memCodeDB (\d -> genericLookupCodeDB (pure $ _codeDB d) k) k
  insert _ k v = writeStore memCodeDB (\d -> genericInsertCodeDB (pure $ _codeDB d) k v) k (Just v)
  delete _ k = writeStore memCodeDB (\d -> genericDeleteCodeDB (pure $ _codeDB d) k) k Nothing

instance A.Selectable FilePath (Either String String) ContextM where
  select _ path = accessEnv >>= \ctx -> liftIO (_resolveFile ctx path)

instance (N.NibbleString `A.Alters` N.NibbleString) ContextM where
  lookup _ k = readStore memHashDB (\d -> genericLookupHashDB (pure $ _hashDB d) k) k
  insert _ k v = writeStore memHashDB (\d -> genericInsertHashDB (pure $ _hashDB d) k v) k (Just v)
  delete _ k = writeStore memHashDB (\d -> genericDeleteHashDB (pure $ _hashDB d) k) k Nothing

instance HasMemRawStorageDB ContextM where
  getMemRawStorageBlockDB = gets $ view $ memDBs . storageBlockMap
  putMemRawStorageBlockMap theMap = modify $ memDBs . storageBlockMap .~ theMap

instance (RawStorageKey `A.Alters` RawStorageValue) ContextM where
  lookup _ = genericLookupRawStorageDB
  insert _ = genericInsertRawStorageDB
  delete _ = genericDeleteRawStorageDB
  lookupWithDefault _ = genericLookupWithDefaultRawStorageDB

instance (Keccak256 `A.Alters` BlockSummary) ContextM where
  lookup _ k = readStore memBlockSummaryDB (\d -> genericLookupBlockSummaryDB (pure $ _blockSummaryDB d) k) k
  insert _ k v = writeStore memBlockSummaryDB (\d -> genericInsertBlockSummaryDB (pure $ _blockSummaryDB d) k v) k (Just v)
  delete _ k = writeStore memBlockSummaryDB (\d -> genericDeleteBlockSummaryDB (pure $ _blockSummaryDB d) k) k Nothing

instance Mod.Accessible SQLDB ContextM where
  access _ = _sqldb <$> getDBs

instance Mod.Accessible RBDB.RedisConnection ContextM where
  access _ = _redisPool <$> getDBs

instance Mod.Modifiable GasCap ContextM where
  get _ = contextGets (GasCap . _vmGasCap)

  put _ (GasCap g) = do
    contextModify (vmGasCap .~ g)
    $logDebugS "#### Mod.put @vmGasCap" . T.pack $ "VM Gas Cap updated to: " ++ show g
