{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}

{-# OPTIONS -fno-warn-deprecations #-}

module Control.Monad.Composable.VaultProxy where

import           Control.Monad.Reader

import           Control.Monad.Change.Modify

import           Network.HTTP.Client
-- import           Network.HTTP.Conduit

import           Servant.Client

data VaultProxyData =
  VaultProxyData {
    urlVaultProxy :: BaseUrl,
    httpManager :: Manager
  }

type VaultProxyM = ReaderT VaultProxyData

type HasVaultProxy m = Accessible VaultProxyData m

runVaultProxyM :: MonadIO m => String -> VaultProxyM m a -> m a
runVaultProxyM url f = do
  mgr <- liftIO $ newManager defaultManagerSettings
  vaultProxyUrl <- liftIO $ parseBaseUrl url

  runReaderT f $ VaultProxyData vaultProxyUrl mgr

