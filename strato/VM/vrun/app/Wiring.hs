{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
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
{-# OPTIONS -fno-warn-unused-imports #-}
{-# OPTIONS -fno-warn-unused-top-binds #-}

module Wiring () where

import BlockApps.Init ()
import BlockApps.Logging
import BlockApps.X509.Certificate
import Blockchain.Bagger.BaggerState (BaggerState, defaultBaggerState)
import Blockchain.Constants
import Blockchain.DB.BlockSummaryDB
import Blockchain.DB.ChainDB
import Blockchain.DB.CodeDB
import Blockchain.DB.HashDB
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.RawStorageDB
import Blockchain.DB.SQLDB
import Blockchain.DB.StateDB
import Blockchain.DB.StorageDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.Block
import Blockchain.Data.BlockSummary
import Blockchain.Data.ChainInfo
import Blockchain.Data.DataDefs
import Blockchain.Data.RLP
import Blockchain.Data.TransactionResult
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.EthConf
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.CodePtr ()
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Gas
import Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Strato.RedisBlockDB as RBDB
import Blockchain.Strato.RedisBlockDB.Models
import Blockchain.Strato.StateDiff (StateDiff)
import Blockchain.Stream.VMEvent
import qualified Blockchain.TxRunResultCache as TRC
import Blockchain.VM.SolidException
import Blockchain.VMContext
import Blockchain.VMOptions
import Control.DeepSeq
import Control.Lens hiding (Context (..))
import Control.Monad.Catch (MonadCatch)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Base
import Control.Monad.IO.Class
import Control.Monad.Reader
import Control.Monad.Trans.Resource
import qualified Data.ByteString as B
import Data.Default
import Data.Either.Extra
import qualified Data.Map as M
import Data.Maybe (fromMaybe)
import qualified Data.NibbleString as N
import qualified Data.Set as S
import qualified Data.Text as T
import qualified Data.Text.Encoding as Text
import Data.Traversable (for)
import qualified Database.LevelDB as DB
import qualified Database.Persist.Sqlite as Lite
import qualified Database.Redis as Redis
import Debugger
import Executable.EVMFlags
import GHC.Generics
import qualified Network.Kafka as K
import qualified Network.Kafka.Protocol as K
import SolidVM.Model.Storable
import SolidVM.Model.Value
import System.Directory
import Text.PrettyPrint.ANSI.Leijen hiding ((<$>), (</>))
import Text.Read (readMaybe)
import UnliftIO

instance Mod.Modifiable ContextState ContextM where
  get _ = get
  put _ = put

instance Mod.Accessible Context ContextM where
  access _ = ask

instance Mod.Modifiable (Maybe DebugSettings) ContextM where
  get _ = gets $ view debugSettings
  put _ ds = modify $ debugSettings .~ ds

instance Mod.Accessible ContextState ContextM where
  access _ = get

instance Mod.Accessible MemDBs ContextM where
  access _ = gets $ view memDBs

instance Mod.Modifiable MemDBs ContextM where
  get _ = gets $ view memDBs
  put _ md = modify $ memDBs .~ md

instance Mod.Accessible IsBlockstanbul ContextM where
  access _ = IsBlockstanbul <$> contextGets _hasBlockstanbul

instance Mod.Modifiable BaggerState ContextM where
  get _ = contextGets _baggerState
  put _ s = contextModify $ baggerState .~ s

instance Mod.Accessible TRC.Cache ContextM where
  access _ = contextGets _txRunResultsCache

instance ContextM `Mod.Yields` TransactionResult where
  yield = void . putTransactionResult

vmBlockHashRootKey :: B.ByteString
vmBlockHashRootKey = "block_hash_root"

vmGenesisRootKey :: B.ByteString
vmGenesisRootKey = "genesis_root"

vmBestBlockRootKey :: B.ByteString
vmBestBlockRootKey = "best_block_root"

instance Mod.Modifiable BlockHashRoot ContextM where
  get _ = do
    db <- getStateDB
    BlockHashRoot . maybe MP.emptyTriePtr MP.StateRoot <$> DB.get db def vmBlockHashRootKey
  put _ (BlockHashRoot (MP.StateRoot sr)) = do
    db <- getStateDB
    DB.put db def vmBlockHashRootKey sr

instance Mod.Modifiable GenesisRoot ContextM where
  get _ = do
    db <- getStateDB
    GenesisRoot . maybe MP.emptyTriePtr MP.StateRoot <$> DB.get db def vmGenesisRootKey
  put _ (GenesisRoot (MP.StateRoot sr)) = do
    db <- getStateDB
    DB.put db def vmGenesisRootKey sr

instance Mod.Modifiable BestBlockRoot ContextM where
  get _ = do
    db <- getStateDB
    BestBlockRoot . maybe MP.emptyTriePtr MP.StateRoot <$> DB.get db def vmBestBlockRootKey
  put _ (BestBlockRoot (MP.StateRoot sr)) = do
    db <- getStateDB
    DB.put db def vmBestBlockRootKey sr

instance Mod.Modifiable K.KafkaState ContextM where
  get _ = readIORef =<< view (dbs . kafkaState)
  put _ ks = view (dbs . kafkaState) >>= flip writeIORef ks

instance Mod.Modifiable CurrentBlockHash ContextM where
  get _ = fmap (fromMaybe (CurrentBlockHash $ unsafeCreateKeccak256FromWord256 0)) . gets $ view $ memDBs . currentBlock
  put _ bh = modify $ memDBs . currentBlock ?~ bh

instance HasMemAddressStateDB ContextM where
  getAddressStateTxDBMap = gets $ view $ memDBs . stateTxMap
  putAddressStateTxDBMap theMap = modify $ memDBs . stateTxMap .~ theMap
  getAddressStateBlockDBMap = gets $ view $ memDBs . stateBlockMap
  putAddressStateBlockDBMap theMap = modify $ memDBs . stateBlockMap .~ theMap

instance (MP.StateRoot `A.Alters` MP.NodeData) ContextM where
  lookup _ = MP.genericLookupDB $ getStateDB
  insert _ = MP.genericInsertDB $ getStateDB
  delete _ = MP.genericDeleteDB $ getStateDB

instance (Account `A.Alters` AddressState) ContextM where
  lookup _ = getAddressStateMaybe
  insert _ = putAddressState
  delete _ = deleteAddressState

instance A.Selectable Account AddressState ContextM where
  select _ = getAddressStateMaybe

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
        putChainStateRoot chainId bh sr
  delete _ chainId = do
    mBH <- gets $ view $ memDBs . currentBlock
    case mBH of
      Nothing -> pure ()
      Just (CurrentBlockHash bh) -> do
        modify $ memDBs . stateRoots %~ M.delete (bh, chainId)
        deleteChainStateRoot chainId bh

instance A.Selectable Word256 ParentChainIds ContextM where
  select _ chainId = fmap (\(_, _, p) -> ParentChainIds p) <$> getChainGenesisInfo (Just chainId)

instance (Keccak256 `A.Alters` DBCode) ContextM where
  lookup _ = genericLookupCodeDB $ getCodeDB
  insert _ = genericInsertCodeDB $ getCodeDB
  delete _ = genericDeleteCodeDB $ getCodeDB

instance ((Address, T.Text) `A.Selectable` X509CertificateField) ContextM where
  select _ (k, t) = do
    let certKey addr = ((Account addr Nothing),) . Text.encodeUtf8
    mCertAddress <- lookupX509AddrFromCBHash k
    fmap join . for mCertAddress $ \certAddress -> do
      maybe Nothing (readMaybe . T.unpack . Text.decodeUtf8) <$> A.lookup (A.Proxy) (certKey certAddress t)

instance (Address `A.Selectable` X509Certificate) ContextM where
  select _ k = do
    let certKey addr = ((Account addr Nothing),) . Text.encodeUtf8
    mCertAddress <- lookupX509AddrFromCBHash k
    fmap join . for mCertAddress $ \certAddress -> do
      mBString <- fmap (rlpDecode . rlpDeserialize) <$> A.lookup (A.Proxy) (certKey certAddress ".certificateString")
      case mBString of
        Just (BString bs) -> pure . eitherToMaybe $ bsToCert bs
        _ -> pure Nothing


instance (N.NibbleString `A.Alters` N.NibbleString) ContextM where
  lookup _ = genericLookupHashDB $ getHashDB
  insert _ = genericInsertHashDB $ getHashDB
  delete _ = genericDeleteHashDB $ getHashDB

instance HasMemRawStorageDB ContextM where
  getMemRawStorageTxDB = gets $ view $ memDBs . storageTxMap
  putMemRawStorageTxMap theMap = modify $ memDBs . storageTxMap .~ theMap
  getMemRawStorageBlockDB = gets $ view $ memDBs . storageBlockMap
  putMemRawStorageBlockMap theMap = modify $ memDBs . storageBlockMap .~ theMap

instance (RawStorageKey `A.Alters` RawStorageValue) ContextM where
  lookup _ = genericLookupRawStorageDB
  insert _ = genericInsertRawStorageDB
  delete _ = genericDeleteRawStorageDB
  lookupWithDefault _ = genericLookupWithDefaultRawStorageDB

instance (Keccak256 `A.Alters` BlockSummary) ContextM where
  lookup _ = genericLookupBlockSummaryDB $ getBlockSummaryDB
  insert _ = genericInsertBlockSummaryDB $ getBlockSummaryDB
  delete _ = genericDeleteBlockSummaryDB $ getBlockSummaryDB

instance MonadReader Context m => Mod.Accessible SQLDB m where
  access _ = view $ dbs . sqldb

instance {-# OVERLAPPING #-} Monad m => AccessibleEnv SQLDB (ReaderT Context m) where
  accessEnv = view $ dbs . sqldb

instance Mod.Accessible RBDB.RedisConnection ContextM where
  access _ = view $ dbs . redisPool

instance Mod.Accessible (Maybe WorldBestBlock) ContextM where
  access _ = do
    mRBB <- RBDB.withRedisBlockDB RBDB.getWorldBestBlockInfo
    for mRBB $ \(RedisBestBlock sha num diff) ->
      return . WorldBestBlock $ BestBlock sha num diff

instance Mod.Modifiable GasCap ContextM where
  get _ = contextGets (GasCap . _vmGasCap)

  put _ (GasCap g) = do
    contextModify (vmGasCap .~ g)
    $logDebugS "#### Mod.put @vmGasCap" . T.pack $ "VM Gas Cap updated to: " ++ show g


