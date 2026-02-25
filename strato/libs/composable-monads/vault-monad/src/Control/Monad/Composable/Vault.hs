{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE UndecidableInstances #-}

{-# OPTIONS_GHC -fno-warn-orphans #-}

module Control.Monad.Composable.Vault
  ( VaultData
  , VaultM
  , runVaultM
  ) where

import Control.Monad.Reader
import Strato.Auth.Client (AuthEnv, newAuthEnv, runWithAuth)
import Blockchain.Strato.Model.Secp256k1 (HasVault(..))
import qualified Strato.Strato23.API.Types as VC
import qualified Strato.Strato23.Client as VC

type VaultData = AuthEnv

type VaultM = ReaderT VaultData

runVaultM :: MonadIO m => String -> VaultM m a -> m a
runVaultM url f = do
  env <- liftIO $ newAuthEnv url
  runReaderT f env

instance {-# OVERLAPPING #-} MonadIO m => HasVault (VaultM m) where
  sign bs = do
    env <- ask
    result <- liftIO $ runWithAuth env (VC.postSignature Nothing (VC.MsgHash bs))
    either (error . show) return result

  getPub = do
    env <- ask
    result <- liftIO $ runWithAuth env (VC.getKey Nothing Nothing)
    either (error . show) return (fmap VC.unPubKey result)

  getShared pub = do
    env <- ask
    result <- liftIO $ runWithAuth env (VC.getSharedKey Nothing True pub)
    either (error . show) return result

-- Lift HasVault through any MonadTrans
instance (HasVault m, MonadTrans t, Monad (t m)) => HasVault (t m) where
  sign = lift . sign
  getPub = lift getPub
  getShared = lift . getShared
