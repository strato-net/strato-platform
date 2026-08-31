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
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Database.MerklePatricia.Profile
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.CodePtr ()
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Util (nibbleString2ByteString)
import Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Strato.RedisBlockDB as RBDB
import qualified Blockchain.TxRunResultCache as TRC
import Blockchain.VMContext
import Control.DeepSeq
import Control.Lens hiding (Context (..))
import Control.Monad (join, void, when)
import Data.Foldable (for_)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Base
import Control.Monad.Composable.Streaming (HasStreaming)
import Control.Monad.IO.Class
import Control.Monad.Reader (ReaderT, ask)
import qualified Data.ByteString as B
import Data.Default
import qualified Data.HashMap.Strict as HM
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

getStateDB :: HasContext m => m DB.DB
getStateDB = fmap (MP.unStateDB . view (dbs.stateDB)) accessEnv

getHashDB :: HasContext m => m HashDB
getHashDB = fmap (view $ dbs.hashDB) accessEnv

getCodeDB :: HasContext m => m CodeDB
getCodeDB = fmap (view $ dbs.codeDB) accessEnv

getBlockSummaryDB :: HasContext m => m BlockSummaryDB
getBlockSummaryDB = fmap (view $ dbs.blockSummaryDB) accessEnv

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


instance HasContext m => Mod.Modifiable ContextState m where
  get _ = get
  put _ = put

instance HasContext m => Mod.Modifiable (Maybe DebugSettings) m where
  get _ = gets $ view debugSettings
  put _ ds = modify $ debugSettings .~ ds

instance HasContext m => Mod.Modifiable (Maybe VmTracer) m where
  get _ = gets $ view vmTracer
  put _ t = modify $ vmTracer .~ t

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible ContextState (ReaderT Context m) where
  access _ = get

instance HasContext m => Mod.Modifiable MemDBs m where
  get _ = gets $ view memDBs
  put _ md = modify $ memDBs .~ md

instance HasContext m => Mod.Modifiable BaggerState m where
  get _ = contextGets _baggerState
  put _ s = contextModify $ baggerState .~ s

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible TRC.Cache (ReaderT Context m) where
  access _ = contextGets _txRunResultsCache

instance {-# OVERLAPPING #-} HasStreaming m => m `Mod.Yields` TransactionResult where
  yield tr = void $ produceVMEvents [NewTransactionResult tr]

vmBlockHashRootKey :: B.ByteString
vmBlockHashRootKey = "block_hash_root"

instance HasContext m => Mod.Modifiable BlockHashRoot m where
  get _ = do
    pendingRef <- view mpPendingBlockHashRoot <$> accessEnv
    pending <- liftIO $ readIORef pendingRef
    case pending of
      Just sr -> pure . BlockHashRoot $ MP.StateRoot sr
      Nothing -> do
        db <- getStateDB
        result <- DB.get db def vmBlockHashRootKey
        liftIO $ do
          bumpDBProfile LevelDBGetOps 1
          bumpDBProfile LevelDBGetKeyBytes $ fromIntegral (B.length vmBlockHashRootKey)
          case result of
            Nothing -> bumpDBProfile LevelDBGetMisses 1
            Just bytes -> do
              bumpDBProfile LevelDBGetHits 1
              bumpDBProfile LevelDBReadBytes $ fromIntegral (B.length bytes)
        pure . BlockHashRoot . maybe MP.emptyTriePtr MP.StateRoot $ result
  put _ (BlockHashRoot (MP.StateRoot sr)) = do
    pendingRef <- view mpPendingBlockHashRoot <$> accessEnv
    liftIO $ writeIORef pendingRef (Just sr)

instance HasContext m => Mod.Modifiable CurrentBlockHash m where
  get _ = fmap (fromMaybe (CurrentBlockHash $ unsafeCreateKeccak256FromWord256 0)) . gets $ view $ memDBs . currentBlock
  put _ bh = modify $ memDBs . currentBlock ?~ bh

instance HasContext m => HasMemAddressStateDB m where
  getAddressStateTxDBMap = gets $ view $ memDBs . stateTxMap
  putAddressStateTxDBMap theMap = modify $ memDBs . stateTxMap .~ theMap
  getAddressStateBlockDBMap = gets $ view $ memDBs . stateBlockMap
  putAddressStateBlockDBMap theMap = modify $ memDBs . stateBlockMap .~ theMap

instance MonadUnliftIO m => (MP.StateRoot `A.Alters` MP.NodeData) (ReaderT Context m) where
  lookup _ sr@(MP.StateRoot key) = do
    liftIO $ bumpDBProfile TrieNodesRead 1
    ctx <- ask
    pending <- liftIO $ readIORef (ctx ^. mpPendingNodes)
    case HM.lookup key pending of
      Just nd -> do
        liftIO $ bumpDBProfile TrieNodePendingCacheHits 1
        pure (Just nd)
      Nothing -> do
        let cacheRef = ctx ^. mpNodeCache
        cache <- liftIO $ readIORef cacheRef
        case HM.lookup key cache of
          Just nd -> do
            liftIO $ bumpDBProfile TrieNodeCacheHits 1
            pure (Just nd)
          Nothing -> do
            liftIO $ do
              bumpDBProfile TrieNodeCacheMisses 1
              bumpDBProfile TrieNodeLevelDBReads 1
            mnd <- MP.genericLookupDB getStateDB sr
            liftIO $ for_ mnd $ \nd -> modifyIORef' cacheRef (HM.insert key nd)
            pure mnd
  insert _ (MP.StateRoot key) nd = do
    cacheRef <- view mpNodeCache <$> ask
    cache <- liftIO $ readIORef cacheRef
    case HM.lookup key cache of
      Just cached
        | cached == nd -> liftIO $ bumpDBProfile TrieNodesReused 1
        | otherwise -> error "MP node hash collision: cached node differs"
      Nothing -> do
        pendingRef <- view mpPendingNodes <$> ask
        pending <- liftIO $ readIORef pendingRef
        case HM.lookup key pending of
          Just staged
            | staged == nd -> liftIO $ bumpDBProfile TrieNodesReused 1
            | otherwise -> error "MP node hash collision: pending node differs"
          Nothing -> liftIO $ do
            bumpDBProfile TrieNodesCreated 1
            modifyIORef' pendingRef (HM.insert key nd)
  delete _ sr@(MP.StateRoot key) = do
    liftIO $ bumpDBProfile TrieNodesDeleted 1
    cacheRef <- view mpNodeCache <$> ask
    liftIO $ modifyIORef' cacheRef (HM.delete key)
    pendingRef <- view mpPendingNodes <$> ask
    liftIO $ modifyIORef' pendingRef (HM.delete key)
    MP.genericDeleteDB getStateDB sr

instance HasContext m => HasPendingMPNodes m where
  flushPendingMPNodes = do
    liftIO $ bumpDBProfile PendingMerkleFlushRequests 1
    ctx <- accessEnv
    count <- liftIO $ atomicModifyIORef' (ctx ^. mpFlushCount) $ \n -> let n' = n + 1 in (n', n')
    when (count >= ctx ^. mpFlushInterval) flushPendingMPNodesNow
  finalizePendingMPNodes = flushPendingMPNodesNow
  clearPendingMPNodes = do
    ctx <- accessEnv
    liftIO $ do
      writeIORef (ctx ^. mpPendingNodes) HM.empty
      writeIORef (ctx ^. mpPendingBlockHashRoot) Nothing
      writeIORef (ctx ^. mpFlushCount) 0

flushPendingMPNodesNow :: HasContext m => m ()
flushPendingMPNodesNow = do
    pendingRef <- view mpPendingNodes <$> accessEnv
    pending <- liftIO $ readIORef pendingRef
    rootRef <- view mpPendingBlockHashRoot <$> accessEnv
    pendingRoot <- liftIO $ readIORef rootRef
    db <- getStateDB
    let pendingWrites =
          [ (key, MP.serializeNodeData node)
          | (key, node) <- HM.toList pending
          ]
        rootWrites = maybe [] (pure . (vmBlockHashRootKey,)) pendingRoot
        writes = pendingWrites ++ rootWrites
    DB.write db def [DB.Put key value | (key, value) <- writes]
    liftIO $ do
      bumpDBProfile LevelDBWriteBatches 1
      bumpDBProfile LevelDBBatchPutOps $ fromIntegral (length writes)
      bumpDBProfile LevelDBWriteBytes . fromIntegral $
        sum [B.length key + B.length value | (key, value) <- writes]
      bumpDBProfile TrieNodesWritten $ fromIntegral (length pendingWrites)
    cacheRef <- view mpNodeCache <$> accessEnv
    liftIO $ do
      modifyIORef' cacheRef $ \cache ->
        HM.union pending $ if HM.size cache > 200000 then HM.empty else cache
      writeIORef pendingRef HM.empty
      writeIORef rootRef Nothing
    countRef <- view mpFlushCount <$> accessEnv
    liftIO $ writeIORef countRef 0


instance (MonadUnliftIO m, MonadLogger m, HasContext m, (MP.StateRoot `A.Alters` MP.NodeData) m) => (Address `A.Alters` AddressState) m where
  lookup _ = getAddressStateMaybe
  insert _ = putAddressState
  delete _ = deleteAddressState

instance (MonadUnliftIO m, MonadLogger m, HasContext m, (MP.StateRoot `A.Alters` MP.NodeData) m) => (Maybe Word256 `A.Alters` MP.StateRoot) m where
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

instance HasContext m => (Keccak256 `A.Alters` DBCode) m where
  lookup _ = genericLookupCodeDB $ getCodeDB
  insert _ = genericInsertCodeDB $ getCodeDB
  delete _ = genericDeleteCodeDB $ getCodeDB

instance (MonadUnliftIO m, HasContext m) => (N.NibbleString `A.Alters` N.NibbleString) m where
  lookup _ k = do
    cacheRef <- view hashCache <$> accessEnv
    cache <- liftIO $ readIORef cacheRef
    case HM.lookup (nibbleString2ByteString k) cache of
      Just v -> do
        liftIO $ bumpDBProfile HashCacheHits 1
        pure (Just v)
      Nothing -> do
        liftIO $ bumpDBProfile HashCacheMisses 1
        mv <- genericLookupHashDB getHashDB k
        liftIO $ for_ mv $ \v -> modifyIORef' cacheRef (HM.insert (nibbleString2ByteString k) v)
        pure mv
  insert _ k v = do
    cacheRef <- view hashCache <$> accessEnv
    let key = nibbleString2ByteString k
    cache <- liftIO $ readIORef cacheRef
    case HM.lookup key cache of
      Just cached
        | cached == v -> pure ()
        | otherwise -> error "hash reverse-index collision: cached value differs"
      Nothing -> do
        genericInsertHashDB getHashDB k v
        liftIO $ modifyIORef' cacheRef (HM.insert key v)
  delete _ k = do
    cacheRef <- view hashCache <$> accessEnv
    liftIO $ modifyIORef' cacheRef (HM.delete (nibbleString2ByteString k))
    genericDeleteHashDB getHashDB k

instance (HasContext m) => HasMemRawStorageDB m where
  getMemRawStorageTxDB = gets $ view $ memDBs . storageTxMap
  putMemRawStorageTxMap theMap = modify $ memDBs . storageTxMap .~ theMap
  getMemRawStorageBlockDB = gets $ view $ memDBs . storageBlockMap
  putMemRawStorageBlockMap theMap = modify $ memDBs . storageBlockMap .~ theMap

instance (MonadUnliftIO m, MonadLogger m, HasContext m, (MP.StateRoot `A.Alters` MP.NodeData) m) => (RawStorageKey `A.Alters` RawStorageValue) m where
  lookup _ = genericLookupRawStorageDB
  insert _ = genericInsertRawStorageDB
  delete _ = genericDeleteRawStorageDB
  lookupWithDefault _ = genericLookupWithDefaultRawStorageDB

instance HasContext m => (Keccak256 `A.Alters` BlockSummary) m where
  lookup _ = genericLookupBlockSummaryDB $ getBlockSummaryDB
  insert _ = genericInsertBlockSummaryDB $ getBlockSummaryDB
  delete _ = genericDeleteBlockSummaryDB $ getBlockSummaryDB

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible SQLDB (ReaderT Context m) where
  access _ = fmap (view (dbs.sqldb)) accessEnv

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible RBDB.RedisConnection (ReaderT Context m) where
  access _ = fmap (view $ dbs . redisPool) accessEnv

instance (MonadLogger m, HasContext m) => Mod.Modifiable GasCap m where
  get _ = contextGets (GasCap . _vmGasCap)

  put _ (GasCap g) = do
    contextModify (vmGasCap .~ g)
    $logDebugS "#### Mod.put @vmGasCap" . T.pack $ "VM Gas Cap updated to: " ++ show g
