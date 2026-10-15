{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DataKinds #-}
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
  runSetupDBM,
  runSetupDBMInDir
  ) where

import BlockApps.Logging
import Blockchain.Constants
import Blockchain.DB.CodeDB
import Blockchain.DB.HashDB
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.RawStorageDB
import Blockchain.DB.StateDB
import Blockchain.Data.AddressStateDB
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Keccak256
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.AccountDB
import Control.Monad.Composable.Base
import Control.Monad.Composable.StateDB
import Control.Monad.IO.Class
import Data.IORef
import qualified Data.NibbleString as N
import qualified Database.LevelDB as DB
import System.Directory (createDirectoryIfMissing)

data SetupDBs = SetupDBs
  { hashDB :: HashDB,
    codeDB :: CodeDB
  }

type HasDBs m = (Mod.Accessible SetupDBs m, HasStateDB m, HasMemAddressStateDB m, HasMemRawStorageDB m)

runSetupDBM :: (InternalState :> es) =>
               Eff (SetupDBs ': AccountDBEnv ': StateDBEnv ': es) b -> Eff es b
runSetupDBM = runSetupDBMInDir ".ethereumH"

-- | Run setup with databases in a specified directory.
-- Useful for genesis-builder which needs its own temp database to avoid locking conflicts.
runSetupDBMInDir :: (InternalState :> es) =>
                    FilePath -> Eff (SetupDBs ': AccountDBEnv ': StateDBEnv ': es) b -> Eff es b
runSetupDBMInDir baseDir mv = do
  liftIO $ createDirectoryIfMissing True baseDir
  let open path = DB.open (baseDir ++ path) DB.defaultOptions {DB.createIfMissing = True, DB.cacheSize = 1024}
  sdb <- newStateDBEnv . nodeDB . levelDBBytes =<< open stateDBPath
  adb <- newAccountDBEnv
  -- Roots are kept per block; setup has no block, so use the zero hash.
  liftIO $ writeIORef (currentBlock adb) (Just . CurrentBlockHash $ unsafeCreateKeccak256FromWord256 0)
  hdb <- HashDB <$> open hashDBPath
  cdb <- CodeDB <$> open codeDBPath
  runStateDBM sdb . runAccountDBM adb $ provide (SetupDBs hdb cdb) mv

instance (MonadIO m, MonadLogger m, HasDBs m) => (RawStorageKey `A.Alters` RawStorageValue) m where
  lookup _ = genericLookupRawStorageDB
  insert _ = genericInsertRawStorageDB
  delete _ = genericDeleteRawStorageDB

instance (MonadIO m, MonadLogger m, HasDBs m) => (Address `A.Alters` AddressState) m where
  lookup _ = getAddressStateMaybe
  insert _ = putAddressState
  delete _ = deleteAddressState

instance {-# OVERLAPPING #-} (SetupDBs :> es, AccountDBEnv :> es, StateDBEnv :> es, Logger :> es) => (Address `A.Selectable` AddressState) (Eff es) where
  select _ = getAddressStateMaybe

instance (MonadIO m, MonadLogger m, HasDBs m) => (Keccak256 `A.Alters` DBCode) m where
  lookup _ = genericLookupCodeDB $ fmap codeDB $ Mod.access Mod.Proxy
  insert _ = genericInsertCodeDB $ fmap codeDB $ Mod.access Mod.Proxy
  delete _ = genericDeleteCodeDB $ fmap codeDB $ Mod.access Mod.Proxy

instance {-# OVERLAPPING #-} (SetupDBs :> es) => A.Selectable FilePath (Either String String) (Eff es) where
  select _ _ = pure Nothing

instance (MonadIO m, MonadLogger m, HasDBs m) => (N.NibbleString `A.Alters` N.NibbleString) m where
  lookup _ = genericLookupHashDB $ fmap hashDB $ Mod.access Mod.Proxy
  insert _ = genericInsertHashDB $ fmap hashDB $ Mod.access Mod.Proxy
  delete _ = genericDeleteHashDB $ fmap hashDB $ Mod.access Mod.Proxy

{-
instance (Monad m, MonadIO m, MonadLogger m, HasDBs m) => Mod.Accessible SQLDB m where
  access _ = fmap sqlDB $ Mod.access Mod.Proxy
-}
