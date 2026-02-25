{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}

module Control.Monad.Composable.Vault where

import Control.Monad.Reader
import Strato.Auth.Client (AuthEnv, newAuthEnv)

type VaultData = AuthEnv

type VaultM = ReaderT VaultData

runVaultM :: MonadIO m => String -> VaultM m a -> m a
runVaultM url f = do
  env <- liftIO $ newAuthEnv url
  runReaderT f env
