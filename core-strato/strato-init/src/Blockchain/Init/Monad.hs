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
import           Database.Persist.Postgresql        (createPostgresqlPool)
import           System.FilePath                    ((</>))

import           Blockchain.Constants
import           Blockchain.Data.AddressStateDB
import qualified Blockchain.Database.MerklePatricia as MP
import           Blockchain.DB.CodeDB
import           Blockchain.DB.HashDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.RawStorageDB
import           Blockchain.DB.SQLDB
import           Blockchain.DB.StateDB
import           Blockchain.EthConf (lookupRedisBlockDBConfig, connStr)
import           Blockchain.Output
import           Blockchain.SHA
import qualified Blockchain.Strato.RedisBlockDB     as RBDB
import           Blockchain.Strato.Model.Address


data SetupDBs =
  SetupDBs {
    stateDB :: StateDB,
    stateRoot :: IORef MP.StateRoot,
    hashDB  :: HashDB,
    codeDB  :: CodeDB,
    sqlDB   :: SQLDB,
    redisDB :: RBDB.RedisConnection,
    localStorageTx :: IORef (M.Map (Address, B.ByteString) B.ByteString),
    localStorageBlock :: IORef (M.Map (Address, B.ByteString) B.ByteString),
    localAddressStateTx :: IORef (M.Map Address AddressStateModification),
    localAddressStateBlock :: IORef (M.Map Address AddressStateModification)
    }

type SetupDBM = ReaderT SetupDBs (LoggingT (ResourceT IO))

runSetupDBM :: SetupDBM a -> LoggingT (ResourceT IO) a
runSetupDBM mv = do
  let open path = DB.open (".ethereumH" </> path) DB.defaultOptions{DB.createIfMissing=True, DB.cacheSize=1024}
  sdb <- open stateDBPath
  srRef <- liftIO . newIORef $ error "stateRoot used before defined"
  hdb <- HashDB <$> open hashDBPath
  cdb <- CodeDB <$> open codeDBPath
  [m1, m2] <- liftIO . replicateM 2 . newIORef $ M.empty
  [m3, m4] <- liftIO . replicateM 2 . newIORef $ M.empty
  pool <- createPostgresqlPool connStr 20
  redisConn <- RBDB.RedisConnection <$> liftIO (Redis.checkedConnect lookupRedisBlockDBConfig)
  runReaderT mv $ SetupDBs sdb srRef hdb cdb pool redisConn m1 m2 m3 m4


instance Mod.Modifiable MP.StateRoot SetupDBM where
  get _    = liftIO . readIORef =<< asks stateRoot
  put _ sr = do
    srRef <- asks stateRoot
    liftIO $ atomicWriteIORef srRef sr

instance (MP.StateRoot `A.Alters` MP.NodeData) SetupDBM where
  lookup _ = MP.genericLookupDB $ asks stateDB
  insert _ = MP.genericInsertDB $ asks stateDB
  delete _ = MP.genericDeleteDB $ asks stateDB

instance HasMemRawStorageDB SetupDBM where
  getMemRawStorageTxDB = do
    cxt <- ask
    lst <- liftIO . readIORef .localStorageTx $ cxt
    return (stateDB cxt, lst)
  putMemRawStorageTxMap theMap = do
    lstref <- asks localStorageTx
    liftIO $ atomicWriteIORef lstref theMap
  getMemRawStorageBlockDB = do
    cxt <- ask
    lsb <- liftIO . readIORef . localStorageBlock $ cxt
    return (stateDB cxt, lsb)
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

instance (Address `A.Alters` AddressState) SetupDBM where
  lookup _ = getAddressStateMaybe
  insert _ = putAddressState
  delete _ = deleteAddressState

instance (SHA `A.Alters` DBCode) SetupDBM where
  lookup _ = genericLookupCodeDB $ asks codeDB
  insert _ = genericInsertCodeDB $ asks codeDB
  delete _ = genericDeleteCodeDB $ asks codeDB

instance (N.NibbleString `A.Alters` N.NibbleString) SetupDBM where
  lookup _ = genericLookupHashDB $ asks hashDB
  insert _ = genericInsertHashDB $ asks hashDB
  delete _ = genericDeleteHashDB $ asks hashDB

instance Mod.Accessible SQLDB SetupDBM where
  access _ = asks sqlDB

instance Mod.Accessible RBDB.RedisConnection SetupDBM where
  access _ = asks redisDB
