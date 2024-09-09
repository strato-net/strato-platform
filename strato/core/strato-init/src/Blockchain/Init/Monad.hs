{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE UndecidableInstances #-}

{-# OPTIONS -fno-warn-orphans #-}

-- There are instances in this file that won't compile unless I add a `Monad m` constraint, however
-- after I add it, I get a "redundant-constraint" warning.  Is this actually a bug in GHC?
-- Either way, the problem can be fixed by suppressing the warning, meh....
{-# OPTIONS -fno-warn-redundant-constraints #-}

module Blockchain.Init.Monad (
  runSetupDBM
  ) where

import BlockApps.Logging
import BlockApps.X509.Certificate
import Blockchain.Constants
import Blockchain.DB.CodeDB
import Blockchain.DB.HashDB
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.RawStorageDB
import Blockchain.DB.StateDB
import Blockchain.Data.AddressStateDB
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Init.Options (flags_vaultWrapperUrl)
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
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
import Network.HTTP.Client (defaultManagerSettings, newManager)
import Servant.Client
import qualified Strato.Strato23.API as VC
import qualified Strato.Strato23.Client as VC

data SetupDBs = SetupDBs
  { stateDB :: StateDB,
    stateRoots :: IORef (M.Map (Maybe Word256) MP.StateRoot),
    hashDB :: HashDB,
    codeDB :: CodeDB,
    vaultDB :: ClientEnv,
    localStorageTx :: IORef (M.Map (Account, B.ByteString) B.ByteString),
    localStorageBlock :: IORef (M.Map (Account, B.ByteString) B.ByteString),
    localAddressStateTx :: IORef (M.Map Account AddressStateModification),
    localAddressStateBlock :: IORef (M.Map Account AddressStateModification)
  }

type HasDBs m = Mod.Accessible SetupDBs m

runSetupDBM :: (MonadResource m, MonadFail m) =>
               ReaderT SetupDBs m b -> m b
runSetupDBM mv = do
  let open path = DB.open (".ethereumH" ++ path) DB.defaultOptions {DB.createIfMissing = True, DB.cacheSize = 1024}
  sdb <- open stateDBPath
  srRef <- liftIO $ newIORef M.empty
  hdb <- HashDB <$> open hashDBPath
  cdb <- CodeDB <$> open codeDBPath
  [m1, m2] <- liftIO . replicateM 2 . newIORef $ M.empty
  [m3, m4] <- liftIO . replicateM 2 . newIORef $ M.empty
  vdb <- do
    mgr <- liftIO $ newManager defaultManagerSettings
    url <- liftIO $ parseBaseUrl flags_vaultWrapperUrl
    return $ mkClientEnv mgr url
  runReaderT mv $ SetupDBs sdb srRef hdb cdb vdb m1 m2 m3 m4

waitOnVault :: (MonadLogger m, MonadIO m, Show a) => m (Either a b) -> m b
waitOnVault action = do
  res <- action
  case res of
    Left _ -> waitOnVault action
    Right val -> return val

instance (Monad m, MonadIO m, MonadLogger m, HasDBs m) => HasVault m where
  getPub = do
    env <- Mod.access Mod.Proxy
    fmap VC.unPubKey $ waitOnVault $ liftIO $ runClientM (VC.getKey Nothing Nothing) $ vaultDB env
  sign bs = do
    env <- Mod.access Mod.Proxy
    waitOnVault $ liftIO $ runClientM (VC.postSignature Nothing (VC.MsgHash bs)) $ vaultDB env
  getShared _ = error "should not be calling getShared in strato-init"

instance (MonadIO m, MonadLogger m, HasDBs m) => (Maybe Word256 `A.Alters` MP.StateRoot) m where
  lookup _ k = fmap (M.lookup k) $ liftIO . readIORef =<< fmap stateRoots (Mod.access Mod.Proxy)
  insert _ k v = liftIO . flip modifyIORef (M.insert k v) =<< fmap stateRoots (Mod.access Mod.Proxy)
  delete _ k = liftIO . flip modifyIORef (M.delete k) =<< fmap stateRoots (Mod.access Mod.Proxy)

instance (MonadIO m, MonadLogger m, HasDBs m) => (MP.StateRoot `A.Alters` MP.NodeData) m where
  lookup _ = MP.genericLookupDB $ fmap stateDB $ Mod.access Mod.Proxy
  insert _ = MP.genericInsertDB $ fmap stateDB $ Mod.access Mod.Proxy
  delete _ = MP.genericDeleteDB $ fmap stateDB $ Mod.access Mod.Proxy

instance (Monad m, MonadIO m, HasDBs m) => HasMemRawStorageDB m where
  getMemRawStorageTxDB = liftIO . readIORef . localStorageTx =<<  Mod.access Mod.Proxy
  putMemRawStorageTxMap theMap = do
    lstref <- fmap localStorageTx $ Mod.access Mod.Proxy
    liftIO $ atomicWriteIORef lstref theMap
  getMemRawStorageBlockDB = liftIO . readIORef . localStorageBlock =<< Mod.access Mod.Proxy
  putMemRawStorageBlockMap theMap = do
    lsbref <- fmap localStorageBlock $ Mod.access Mod.Proxy
    liftIO $ atomicWriteIORef lsbref theMap

instance (MonadIO m, MonadLogger m, HasDBs m) => (RawStorageKey `A.Alters` RawStorageValue) m where
  lookup _ = genericLookupRawStorageDB
  insert _ = genericInsertRawStorageDB
  delete _ = genericDeleteRawStorageDB

instance (MonadIO m, HasDBs m) => HasMemAddressStateDB m where
  getAddressStateTxDBMap = liftIO . readIORef =<< fmap localAddressStateTx (Mod.access Mod.Proxy)
  putAddressStateTxDBMap theMap = do
    lastref <- fmap localAddressStateTx $ Mod.access Mod.Proxy
    liftIO $ atomicWriteIORef lastref theMap
  getAddressStateBlockDBMap = liftIO . readIORef =<< fmap localAddressStateBlock (Mod.access Mod.Proxy)
  putAddressStateBlockDBMap theMap = do
    lasbref <- fmap localAddressStateBlock $ Mod.access Mod.Proxy
    liftIO $ atomicWriteIORef lasbref theMap

instance (MonadIO m, MonadLogger m, HasDBs m) => (Account `A.Alters` AddressState) m where
  lookup _ = getAddressStateMaybe
  insert _ = putAddressState
  delete _ = deleteAddressState

instance (MonadIO m, MonadLogger m, HasDBs m) => (Account `A.Selectable` AddressState) m where
  select _ = getAddressStateMaybe

instance (MonadIO m, MonadLogger m, HasDBs m) => (Keccak256 `A.Alters` DBCode) m where
  lookup _ = genericLookupCodeDB $ fmap codeDB $ Mod.access Mod.Proxy
  insert _ = genericInsertCodeDB $ fmap codeDB $ Mod.access Mod.Proxy
  delete _ = genericDeleteCodeDB $ fmap codeDB $ Mod.access Mod.Proxy

instance (MonadIO m, MonadLogger m, HasDBs m) => (Address `A.Selectable` X509Certificate) m where
  select _ = error "SetupDBM select @X509Certificate"

instance (MonadIO m, MonadLogger m, HasDBs m) => ((Address, T.Text) `A.Selectable` X509CertificateField) m where
  select _ = error "SetupDBM select @X509CertificateField"

instance (MonadIO m, MonadLogger m, HasDBs m) => (N.NibbleString `A.Alters` N.NibbleString) m where
  lookup _ = genericLookupHashDB $ fmap hashDB $ Mod.access Mod.Proxy
  insert _ = genericInsertHashDB $ fmap hashDB $ Mod.access Mod.Proxy
  delete _ = genericDeleteHashDB $ fmap hashDB $ Mod.access Mod.Proxy

{-
instance (Monad m, MonadIO m, MonadLogger m, HasDBs m) => Mod.Accessible SQLDB m where
  access _ = fmap sqlDB $ Mod.access Mod.Proxy
-}
