{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE TypeSynonymInstances #-}

module Blockchain.Init.Monad where

import           Control.Monad
import           Control.Monad.FT
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Reader
import           Control.Monad.Trans.Resource
import qualified Data.ByteString                    as B
import           Data.IORef
import qualified Data.Map                           as M
import qualified Data.NibbleString                  as N
import qualified Database.Redis                     as Redis
import qualified Database.LevelDB                   as DB

import           Blockchain.Constants
import           Blockchain.Data.AddressStateDB
import qualified Blockchain.Database.MerklePatricia as MP
import           Blockchain.DB.CodeDB
import           Blockchain.DB.X509CertDB
import           Blockchain.DB.HashDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.RawStorageDB
import           Blockchain.DB.SQLDB
import           Blockchain.DB.StateDB
import           Blockchain.EthConf (lookupRedisBlockDBConfig, connStr)
import           Blockchain.ExtWord
import           Blockchain.Output
import           Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Strato.RedisBlockDB     as RBDB
import           Blockchain.Strato.Model.Account


data SetupDBs =
  SetupDBs {
    stateDB :: StateDB,
    stateRoots :: IORef (M.Map (Maybe Word256) MP.StateRoot),
    hashDB  :: HashDB,
    codeDB  :: CodeDB,
    x509DB  :: X509CertDB,
    sqlDB   :: SQLDB,
    redisDB :: RBDB.RedisConnection,
    localStorageTx :: IORef (M.Map (Account, B.ByteString) B.ByteString),
    localStorageBlock :: IORef (M.Map (Account, B.ByteString) B.ByteString),
    localAddressStateTx :: IORef (M.Map Account AddressStateModification),
    localAddressStateBlock :: IORef (M.Map Account AddressStateModification)
    }

type SetupDBM = ReaderT SetupDBs (ResourceT (LoggingT IO))

runSetupDBM :: SetupDBM a -> ResourceT (LoggingT IO) a
runSetupDBM mv = do
  let open path = DB.open (".ethereumH" ++ path) DB.defaultOptions{DB.createIfMissing=True, DB.cacheSize=1024}
  sdb <- open stateDBPath
  srRef <- liftIO $ newIORef M.empty
  hdb <- HashDB <$> open hashDBPath
  cdb <- CodeDB <$> open codeDBPath
  xdb <- X509CertDB <$> open x509CertDBPath
  [m1, m2] <- liftIO . replicateM 2 . newIORef $ M.empty
  [m3, m4] <- liftIO . replicateM 2 . newIORef $ M.empty
  pool <- createPostgresqlPool connStr 20
  redisConn <- RBDB.RedisConnection <$> liftIO (Redis.checkedConnect lookupRedisBlockDBConfig)
  runReaderT mv $ SetupDBs sdb srRef hdb cdb xdb pool redisConn m1 m2 m3 m4

instance Selectable MP.StateRoot (Maybe Word256) SetupDBM where
  select k = fmap (M.lookup k) $ liftIO . readIORef =<< asks stateRoots
instance Insertable MP.StateRoot (Maybe Word256) SetupDBM where
  insert k v = liftIO . flip modifyIORef (M.insert k v) =<< asks stateRoots
instance Deletable  MP.StateRoot (Maybe Word256) SetupDBM where
  delete k = liftIO . flip modifyIORef (M.delete k) =<< asks stateRoots
instance Alterable  MP.StateRoot (Maybe Word256) SetupDBM where

instance Selectable MP.NodeData MP.StateRoot SetupDBM where
  select = MP.genericLookupDB $ asks stateDB
instance Insertable MP.NodeData MP.StateRoot SetupDBM where
  insert = MP.genericInsertDB $ asks stateDB
instance Deletable  MP.NodeData MP.StateRoot SetupDBM where
  delete = MP.genericDeleteDB $ asks stateDB
instance Alterable  MP.NodeData MP.StateRoot SetupDBM where

instance HasMemRawStorageDB SetupDBM where
  getMemRawStorageTxDB = liftIO . readIORef .localStorageTx =<< ask
  putMemRawStorageTxMap theMap = do
    lstref <- asks localStorageTx
    liftIO $ atomicWriteIORef lstref theMap
  getMemRawStorageBlockDB = liftIO . readIORef . localStorageBlock =<< ask
  putMemRawStorageBlockMap theMap = do
    lsbref <- asks localStorageBlock
    liftIO $ atomicWriteIORef lsbref theMap

instance Selectable RawStorageValue RawStorageKey SetupDBM where
  select = genericLookupRawStorageDB
instance Insertable RawStorageValue RawStorageKey SetupDBM where
  insert = genericInsertRawStorageDB
instance Deletable  RawStorageValue RawStorageKey SetupDBM where
  delete = genericDeleteRawStorageDB
instance Alterable  RawStorageValue RawStorageKey SetupDBM where

instance HasMemAddressStateDB SetupDBM where
  getAddressStateTxDBMap = liftIO . readIORef =<< asks localAddressStateTx
  putAddressStateTxDBMap theMap = do
    lastref <- asks localAddressStateTx
    liftIO $ atomicWriteIORef lastref theMap
  getAddressStateBlockDBMap = liftIO . readIORef =<< asks localAddressStateBlock
  putAddressStateBlockDBMap theMap = do
    lasbref <- asks localAddressStateBlock
    liftIO $ atomicWriteIORef lasbref theMap

instance Selectable AddressState Account SetupDBM where
  select = getAddressStateMaybe
instance Insertable AddressState Account SetupDBM where
  insert = putAddressState
instance Deletable  AddressState Account SetupDBM where
  delete = deleteAddressState
instance Alterable  AddressState Account SetupDBM where

instance Selectable DBCode Keccak256 SetupDBM where
  select = genericLookupCodeDB $ asks codeDB
instance Insertable DBCode Keccak256 SetupDBM where
  insert = genericInsertCodeDB $ asks codeDB
instance Deletable  DBCode Keccak256 SetupDBM where
  delete = genericDeleteCodeDB $ asks codeDB
instance Alterable  DBCode Keccak256 SetupDBM where

instance Selectable X509Certificate Account SetupDBM where
  select = genericLookupX509CertDB $ asks x509DB
instance Insertable X509Certificate Account SetupDBM where
  insert = genericInsertX509CertDB $ asks x509DB
instance Deletable  X509Certificate Account SetupDBM where
  delete = genericDeleteX509CertDB $ asks x509DB
instance Alterable  X509Certificate Account SetupDBM where

instance Selectable N.NibbleString N.NibbleString SetupDBM where
  select = genericLookupHashDB $ asks hashDB
instance Insertable N.NibbleString N.NibbleString SetupDBM where
  insert = genericInsertHashDB $ asks hashDB
instance Deletable  N.NibbleString N.NibbleString SetupDBM where
  delete = genericDeleteHashDB $ asks hashDB
instance Alterable  N.NibbleString N.NibbleString SetupDBM where

instance Gettable SQLDB SetupDBM where
  get = asks sqlDB

instance Gettable RBDB.RedisConnection SetupDBM where
  get = asks redisDB
