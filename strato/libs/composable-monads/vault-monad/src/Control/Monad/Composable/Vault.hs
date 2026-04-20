{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE UndecidableInstances #-}

{-# OPTIONS_GHC -fno-warn-orphans #-}

module Control.Monad.Composable.Vault
  ( VaultData
  , VaultM
  , HasVault(..)
  , runVaultM
  ) where

import Control.Monad.Reader
import Data.ByteString (ByteString)
import Strato.Auth.Client (AuthEnv, newAuthEnv, runWithAuth)
import qualified Strato.Strato23.API.Types as VC
import qualified Strato.Strato23.Client as VC

type VaultData = AuthEnv

type VaultM = ReaderT VaultData

-------------------------------------------------------------------
------------------------- TYPECLASSES -----------------------------
-------------------------------------------------------------------

-- This type class allows for the abstraction of common secp256k1 operations
--  in some monad that "has a vault" which stores the private key
--  In prod, this is the vault-wrapper, and we use its servant client
--  In tests, the private key is either in the monad, or a global key
class Monad m => HasVault m where
  sign :: ByteString -> m VC.Signature
  getPub :: m VC.PublicKey
  postKey :: m VC.PublicKey
  getShared :: VC.PublicKey -> m VC.SharedKey

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

  postKey = do
    env <- ask
    result <- liftIO $ runWithAuth env (VC.postKey Nothing)
    either (error . show) return (fmap VC.unPubKey result)

  getShared pub = do
    env <- ask
    result <- liftIO $ runWithAuth env (VC.getSharedKey Nothing True pub)
    either (error . show) return result

-- Lift HasVault through any MonadTrans
instance (HasVault m, MonadTrans t, Monad (t m)) => HasVault (t m) where
  sign = lift . sign
  getPub = lift getPub
  postKey = lift postKey
  getShared = lift . getShared
