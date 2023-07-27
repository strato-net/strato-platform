{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE TypeSynonymInstances #-}

module Blockchain.Init.Monad where

import BlockApps.Logging
import BlockApps.X509.Certificate
import Blockchain.Constants
import Blockchain.DB.CodeDB
import Blockchain.DB.HashDB
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.RawStorageDB
import Blockchain.DB.SQLDB
import Blockchain.DB.StateDB
import Blockchain.Data.AddressStateDB
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.EthConf (connStr, lookupRedisBlockDBConfig)
import Blockchain.Init.Options (flags_vaultWrapperUrl)
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import qualified Blockchain.Strato.RedisBlockDB as RBDB
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.IO.Class
import Control.Monad.Trans.Reader
import Control.Monad.Trans.Resource
import qualified Data.ByteString as B
import Data.IORef
import qualified Data.Map as M
import qualified Data.NibbleString as N
import qualified Data.Text as T
import qualified Database.LevelDB as DB
import qualified Database.Redis as Redis
import Network.HTTP.Client (defaultManagerSettings, newManager)
import Servant.Client
import qualified Strato.Strato23.API as VC
import qualified Strato.Strato23.Client as VC

data SetupDBs = SetupDBs
  { stateDB :: StateDB,
    stateRoots :: IORef (M.Map (Maybe Word256) MP.StateRoot),
    hashDB :: HashDB,
    codeDB :: CodeDB,
    sqlDB :: SQLDB,
    redisDB :: RBDB.RedisConnection,
    vaultDB :: ClientEnv,
    localStorageTx :: IORef (M.Map (Account, B.ByteString) B.ByteString),
    localStorageBlock :: IORef (M.Map (Account, B.ByteString) B.ByteString),
    localAddressStateTx :: IORef (M.Map Account AddressStateModification),
    localAddressStateBlock :: IORef (M.Map Account AddressStateModification)
  }

type SetupDBM = ReaderT SetupDBs (ResourceT (LoggingT IO))

runSetupDBM :: SetupDBM a -> ResourceT (LoggingT IO) a
runSetupDBM mv = do
  let open path = DB.open (".ethereumH" ++ path) DB.defaultOptions {DB.createIfMissing = True, DB.cacheSize = 1024}
  sdb <- open stateDBPath
  srRef <- liftIO $ newIORef M.empty
  hdb <- HashDB <$> open hashDBPath
  cdb <- CodeDB <$> open codeDBPath
  [m1, m2] <- liftIO . replicateM 2 . newIORef $ M.empty
  [m3, m4] <- liftIO . replicateM 2 . newIORef $ M.empty
  pool <- createPostgresqlPool connStr 20
  redisConn <- RBDB.RedisConnection <$> liftIO (Redis.checkedConnect lookupRedisBlockDBConfig)
  vdb <- do
    mgr <- liftIO $ newManager defaultManagerSettings
    url <- liftIO $ parseBaseUrl flags_vaultWrapperUrl
    return $ mkClientEnv mgr url
  runReaderT mv $ SetupDBs sdb srRef hdb cdb pool redisConn vdb m1 m2 m3 m4

waitOnVault :: (MonadLogger m, MonadIO m, Show a) => m (Either a b) -> m b
waitOnVault action = do
  res <- action
  case res of
    Left _ -> waitOnVault action
    Right val -> return val

instance HasVault SetupDBM where
  getPub = do
    vc <- asks vaultDB
    fmap VC.unPubKey $ waitOnVault $ liftIO $ runClientM (VC.getKey Nothing Nothing) vc
  sign bs = do
    vc <- asks vaultDB
    waitOnVault $ liftIO $ runClientM (VC.postSignature Nothing (VC.MsgHash bs)) vc
  getShared _ = error "should not be calling getShared in strato-init"

instance (Maybe Word256 `A.Alters` MP.StateRoot) SetupDBM where
  lookup _ k = fmap (M.lookup k) $ liftIO . readIORef =<< asks stateRoots
  insert _ k v = liftIO . flip modifyIORef (M.insert k v) =<< asks stateRoots
  delete _ k = liftIO . flip modifyIORef (M.delete k) =<< asks stateRoots

instance (MP.StateRoot `A.Alters` MP.NodeData) SetupDBM where
  lookup _ = MP.genericLookupDB $ asks stateDB
  insert _ = MP.genericInsertDB $ asks stateDB
  delete _ = MP.genericDeleteDB $ asks stateDB

instance HasMemRawStorageDB SetupDBM where
  getMemRawStorageTxDB = liftIO . readIORef . localStorageTx =<< ask
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

instance (Address `A.Selectable` X509Certificate) SetupDBM where
  select _ = error "SetupDBM select @X509Certificate"

instance ((Address, T.Text) `A.Selectable` X509CertificateField) SetupDBM where
  select _ = error "SetupDBM select @X509CertificateField"

instance (N.NibbleString `A.Alters` N.NibbleString) SetupDBM where
  lookup _ = genericLookupHashDB $ asks hashDB
  insert _ = genericInsertHashDB $ asks hashDB
  delete _ = genericDeleteHashDB $ asks hashDB

instance Mod.Accessible SQLDB SetupDBM where
  access _ = asks sqlDB

instance Mod.Accessible RBDB.RedisConnection SetupDBM where
  access _ = asks redisDB
