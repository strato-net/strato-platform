{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}

{-# OPTIONS -fno-warn-deprecations #-}

module Control.Monad.Composable.Vault where

import           Control.Monad.Reader

import           Control.Monad.Change.Modify

import           Network.HTTP.Client

import           Network.HTTP.Client.TLS

import           Servant.Client

data VaultData =
  VaultData {
    urlVaultWrapper :: BaseUrl,
    httpManager :: Manager
  }

type VaultM = ReaderT VaultData

type HasVault m = Accessible VaultData m

runVaultM :: MonadIO m => String -> VaultM m a -> m a
runVaultM url f = do
  mgr <- liftIO $ newManager defaultManagerSettings
  vaultWrapperUrl <- liftIO $ parseBaseUrl url

  runReaderT f $ VaultData vaultWrapperUrl mgr

data IdentityData =
  IdentityData {
    urlIdentityServer :: BaseUrl,
    httpManager' :: Manager
  }


type IdentityM = ReaderT IdentityData

type HasIdentity m = Accessible IdentityData m

runIdentitytM :: MonadIO m => String -> IdentityM m a -> m a
runIdentitytM url f = do
  identityUrl <- liftIO $ parseBaseUrl url
  mgr <- liftIO $ case baseUrlScheme identityUrl of
        Http -> newManager defaultManagerSettings
        Https -> newManager tlsManagerSettings 
  

  runReaderT f $ IdentityData identityUrl mgr


