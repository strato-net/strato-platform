{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}

{-# OPTIONS -fno-warn-deprecations #-}

module Control.Monad.Composable.Vault where

import Control.Monad.Reader
import Network.HTTP.Client
import Servant.Client

data VaultData = VaultData
  { urlVaultWrapper :: BaseUrl,
    httpManager :: Manager
  }

type VaultM = ReaderT VaultData

runVaultM :: MonadIO m => String -> VaultM m a -> m a
runVaultM url f = do
  mgr <- liftIO $ newManager defaultManagerSettings
  vaultWrapperUrl <- liftIO $ parseBaseUrl url

  runReaderT f $ VaultData vaultWrapperUrl mgr
