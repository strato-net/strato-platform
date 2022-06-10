{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE TypeSynonymInstances #-}

module Blockchain.Init.Monad where

import           Control.Monad
import qualified Control.Monad.Change.Alter         as A
import qualified Control.Monad.Change.Modify        as Mod
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
import           Blockchain.Output
import           Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Strato.RedisBlockDB     as RBDB
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ExtendedWord


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

instance (Maybe Word256 `A.Alters` MP.StateRoot) SetupDBM where
  lookup _ k = fmap (M.lookup k) $ liftIO . readIORef =<< asks stateRoots
  insert _ k v = liftIO . flip modifyIORef (M.insert k v) =<< asks stateRoots
  delete _ k = liftIO . flip modifyIORef (M.delete k) =<< asks stateRoots

instance (MP.StateRoot `A.Alters` MP.NodeData) SetupDBM where
  lookup _ = MP.genericLookupDB $ asks stateDB
  insert _ = MP.genericInsertDB $ asks stateDB
  delete _ = MP.genericDeleteDB $ asks stateDB

instance HasMemRawStorageDB SetupDBM where
  getMemRawStorageTxDB = liftIO . readIORef .localStorageTx =<< ask
  putMemRawStorageTxMap theMap = do
    lstref <- asks localStorageTx
    liftIO $ atomicWriteIORef lstref theMap
  getMemRawStorageBlockDB = liftIO . readIORef . localStorageBlock =<< ask
  putMemRawStorageBlockMap theMap = do
    lsbref <- asks localStorageBlock
    liftIO $ atomicWriteIORef lsbref theMap

instance (RawStorageKey `A.Alters` RawStorageValue) SetupDBM where
  lookup _ = genericLookupRawStorageDB
  insert _ = genericInsertRawStorageDB
  delete _ = genericDeleteRawStorageDB

instance HasMemAddressStateDB SetupDBM where
  getAddressStateTxDBMap = liftIO . readIORef =<< asks localAddressStateTx
  putAddressStateTxDBMap theMap = do
    lastref <- asks localAddressStateTx
    liftIO $ atomicWriteIORef lastref theMap
  getAddressStateBlockDBMap = liftIO . readIORef =<< asks localAddressStateBlock
  putAddressStateBlockDBMap theMap = do
    lasbref <- asks localAddressStateBlock
    liftIO $ atomicWriteIORef lasbref theMap

instance (Account `A.Alters` AddressState) SetupDBM where
  lookup _ = getAddressStateMaybe
  insert _ = putAddressState
  delete _ = deleteAddressState

instance (Keccak256 `A.Alters` DBCode) SetupDBM where
  lookup _ = genericLookupCodeDB $ asks codeDB
  insert _ = genericInsertCodeDB $ asks codeDB
  delete _ = genericDeleteCodeDB $ asks codeDB

instance (Address `A.Alters` X509Certificate) SetupDBM where
  lookup _ = genericLookupX509CertDB $ asks x509DB
  insert _ = genericInsertX509CertDB $ asks x509DB
  delete _ = genericDeleteX509CertDB $ asks x509DB

instance (N.NibbleString `A.Alters` N.NibbleString) SetupDBM where
  lookup _ = genericLookupHashDB $ asks hashDB
  insert _ = genericInsertHashDB $ asks hashDB
  delete _ = genericDeleteHashDB $ asks hashDB

instance Mod.Accessible SQLDB SetupDBM where
  access _ = asks sqlDB

instance Mod.Accessible RBDB.RedisConnection SetupDBM where
  access _ = asks redisDB
