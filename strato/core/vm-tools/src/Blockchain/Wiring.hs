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
  )
where

import BlockApps.Init ()
import BlockApps.Logging
import BlockApps.X509.Certificate
import Blockchain.Bagger.BaggerState (BaggerState)
import Blockchain.DB.BlockSummaryDB
import Blockchain.DB.ChainDB
import Blockchain.DB.CodeDB
import Blockchain.DB.HashDB
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.RawStorageDB
import Blockchain.DB.SQLDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.Block
import Blockchain.Data.BlockSummary
import Blockchain.Data.ChainInfo
import Blockchain.Data.DataDefs
import Blockchain.Data.RLP
import Blockchain.Data.TransactionResult
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.CodePtr ()
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Strato.RedisBlockDB as RBDB
import Blockchain.Strato.RedisBlockDB.Models
import qualified Blockchain.TxRunResultCache as TRC
import Blockchain.VMContext
import Control.DeepSeq
import Control.Lens hiding (Context (..))
import Control.Monad (join, void)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Base
import Control.Monad.Composable.SQL
import Control.Monad.IO.Class
import Control.Monad.Reader (ReaderT)
import qualified Data.ByteString as B
import Data.Default
import Data.Either.Extra
import qualified Data.Map as M
import Data.Maybe (fromMaybe)
import qualified Data.NibbleString as N
import qualified Data.Text as T
import qualified Data.Text.Encoding as Text
import Data.Traversable (for)
import qualified Database.LevelDB as DB
import Debugger
import SolidVM.Model.Storable
import Text.Read (readMaybe)
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

instance HasContext m => Mod.Accessible ContextState m where
  access _ = get

instance HasContext m => Mod.Accessible MemDBs m where
  access _ = gets $ view memDBs

instance HasContext m => Mod.Modifiable MemDBs m where
  get _ = gets $ view memDBs
  put _ md = modify $ memDBs .~ md

instance HasContext m => Mod.Accessible IsBlockstanbul m where
  access _ = IsBlockstanbul <$> contextGets _hasBlockstanbul

instance HasContext m => Mod.Modifiable BaggerState m where
  get _ = contextGets _baggerState
  put _ s = contextModify $ baggerState .~ s

instance HasContext m => Mod.Accessible TRC.Cache m where
  access _ = contextGets _txRunResultsCache

instance HasSQL m => m `Mod.Yields` TransactionResult where
  yield = void . putTransactionResult

vmBlockHashRootKey :: B.ByteString
vmBlockHashRootKey = "block_hash_root"

vmGenesisRootKey :: B.ByteString
vmGenesisRootKey = "genesis_root"

vmBestBlockRootKey :: B.ByteString
vmBestBlockRootKey = "best_block_root"

instance HasContext m => Mod.Modifiable BlockHashRoot m where
  get _ = do
    db <- getStateDB
    BlockHashRoot . maybe MP.emptyTriePtr MP.StateRoot <$> DB.get db def vmBlockHashRootKey
  put _ (BlockHashRoot (MP.StateRoot sr)) = do
    db <- getStateDB
    DB.put db def vmBlockHashRootKey sr

instance HasContext m => Mod.Modifiable GenesisRoot m where
  get _ = do
    db <- getStateDB
    GenesisRoot . maybe MP.emptyTriePtr MP.StateRoot <$> DB.get db def vmGenesisRootKey
  put _ (GenesisRoot (MP.StateRoot sr)) = do
    db <- getStateDB
    DB.put db def vmGenesisRootKey sr

instance HasContext m => Mod.Modifiable BestBlockRoot m where
  get _ = do
    db <- getStateDB
    BestBlockRoot . maybe MP.emptyTriePtr MP.StateRoot <$> DB.get db def vmBestBlockRootKey
  put _ (BestBlockRoot (MP.StateRoot sr)) = do
    db <- getStateDB
    DB.put db def vmBestBlockRootKey sr

instance HasContext m => Mod.Modifiable CurrentBlockHash m where
  get _ = fmap (fromMaybe (CurrentBlockHash $ unsafeCreateKeccak256FromWord256 0)) . gets $ view $ memDBs . currentBlock
  put _ bh = modify $ memDBs . currentBlock ?~ bh

instance HasContext m => HasMemAddressStateDB m where
  getAddressStateTxDBMap = gets $ view $ memDBs . stateTxMap
  putAddressStateTxDBMap theMap = modify $ memDBs . stateTxMap .~ theMap
  getAddressStateBlockDBMap = gets $ view $ memDBs . stateBlockMap
  putAddressStateBlockDBMap theMap = modify $ memDBs . stateBlockMap .~ theMap

instance MonadUnliftIO m => (MP.StateRoot `A.Alters` MP.NodeData) (ReaderT Context m) where
  lookup _ = MP.genericLookupDB $ getStateDB
  insert _ = MP.genericInsertDB $ getStateDB
  delete _ = MP.genericDeleteDB $ getStateDB

instance (MonadLogger m, HasContext m, (MP.StateRoot `A.Alters` MP.NodeData) m) => (Account `A.Alters` AddressState) m where
  lookup _ = getAddressStateMaybe
  insert _ = putAddressState
  delete _ = deleteAddressState

instance (MonadLogger m, HasContext m, (MP.StateRoot `A.Alters` MP.NodeData) m) => A.Selectable Account AddressState m where
  select _ = getAddressStateMaybe

instance (MonadLogger m, HasContext m, (MP.StateRoot `A.Alters` MP.NodeData) m) => (Maybe Word256 `A.Alters` MP.StateRoot) m where
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

instance (HasContext m, (MP.StateRoot `A.Alters` MP.NodeData) m) => A.Selectable Word256 ParentChainIds m where
  select _ chainId = fmap (\(_, _, p) -> ParentChainIds p) <$> getChainGenesisInfo (Just chainId)

instance HasContext m => (Keccak256 `A.Alters` DBCode) m where
  lookup _ = genericLookupCodeDB $ getCodeDB
  insert _ = genericInsertCodeDB $ getCodeDB
  delete _ = genericDeleteCodeDB $ getCodeDB

instance (MonadLogger m, HasContext m, (MP.StateRoot `A.Alters` MP.NodeData) m) => ((Address, T.Text) `A.Selectable` X509CertificateField) m where
  select _ (k, t) = do
    let certKey addr = ((Account addr Nothing),) . Text.encodeUtf8
    mCertAddress <- lookupX509AddrFromCBHash k
    fmap join . for mCertAddress $ \certAddress -> do
      maybe Nothing (readMaybe . T.unpack . Text.decodeUtf8) <$> A.lookup (A.Proxy) (certKey certAddress t)

instance (MonadLogger m, HasContext m, (MP.StateRoot `A.Alters` MP.NodeData) m) => (Address `A.Selectable` X509Certificate) m where
  select _ k = do
    let certKey addr = ((Account addr Nothing),) . Text.encodeUtf8
    mCertAddress <- lookupX509AddrFromCBHash k
    fmap join . for mCertAddress $ \certAddress -> do
      mBString <- fmap (rlpDecode . rlpDeserialize) <$> A.lookup (A.Proxy) (certKey certAddress ".certificateString")
      case mBString of
        Just (BString bs) -> pure . eitherToMaybe $ bsToCert bs
        _ -> pure Nothing


instance HasContext m => (N.NibbleString `A.Alters` N.NibbleString) m where
  lookup _ = genericLookupHashDB $ getHashDB
  insert _ = genericInsertHashDB $ getHashDB
  delete _ = genericDeleteHashDB $ getHashDB

instance (HasContext m) => HasMemRawStorageDB m where
  getMemRawStorageTxDB = gets $ view $ memDBs . storageTxMap
  putMemRawStorageTxMap theMap = modify $ memDBs . storageTxMap .~ theMap
  getMemRawStorageBlockDB = gets $ view $ memDBs . storageBlockMap
  putMemRawStorageBlockMap theMap = modify $ memDBs . storageBlockMap .~ theMap

instance (MonadLogger m, HasContext m, (MP.StateRoot `A.Alters` MP.NodeData) m) => (RawStorageKey `A.Alters` RawStorageValue) m where
  lookup _ = genericLookupRawStorageDB
  insert _ = genericInsertRawStorageDB
  delete _ = genericDeleteRawStorageDB
  lookupWithDefault _ = genericLookupWithDefaultRawStorageDB

instance HasContext m => (Keccak256 `A.Alters` BlockSummary) m where
  lookup _ = genericLookupBlockSummaryDB $ getBlockSummaryDB
  insert _ = genericInsertBlockSummaryDB $ getBlockSummaryDB
  delete _ = genericDeleteBlockSummaryDB $ getBlockSummaryDB

instance HasContext m => Mod.Accessible SQLDB m where
  access _ = fmap (view (dbs.sqldb)) accessEnv

instance HasContext m => Mod.Accessible RBDB.RedisConnection m where
  access _ = fmap (view $ dbs . redisPool) accessEnv

instance (MonadIO m, Mod.Accessible RBDB.RedisConnection m) => Mod.Accessible (Maybe WorldBestBlock) m where
  access _ = do
    mRBB <- RBDB.withRedisBlockDB RBDB.getWorldBestBlockInfo
    for mRBB $ \(RedisBestBlock sha num) ->
      return . WorldBestBlock $ BestBlock sha num

instance (MonadLogger m, HasContext m) => Mod.Modifiable GasCap m where
  get _ = contextGets (GasCap . _vmGasCap)

  put _ (GasCap g) = do
    contextModify (vmGasCap .~ g)
    $logDebugS "#### Mod.put @vmGasCap" . T.pack $ "VM Gas Cap updated to: " ++ show g
