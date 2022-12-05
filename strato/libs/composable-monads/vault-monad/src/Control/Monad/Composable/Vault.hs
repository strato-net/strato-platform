{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}

{-# OPTIONS -fno-warn-deprecations #-}

module Control.Monad.Composable.Vault where

import           Control.Monad.Reader

import           Control.Monad.Change.Modify    hiding (Proxy)

import           Data.Text                      as T

import           Data.Text.Encoding             as TE

import           Network.HTTP.Client

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
  --Forward vault requests to the vault-proxy
  let setting = managerSetProxy (proxyEnvironment $ Just $ Proxy (TE.encodeUtf8 $ T.pack "http://localhost") 8013) defaultManagerSettings 
  vaultMgr <- liftIO $ newManager setting
  vaultWrapperUrl <- liftIO $ parseBaseUrl url

  runReaderT f $ VaultData vaultWrapperUrl vaultMgr

