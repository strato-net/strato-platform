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
  , runVaultMWith
  , newVaultAuthEnv
  ) where

import Control.Monad.Reader
import Data.ByteString (ByteString)
import Data.Maybe (fromMaybe)
import Strato.Auth.Client (AuthEnv, newAuthEnv, newAuthEnvWith, newAuthEnvWithCreds, runWithAuth)
import Strato.Auth.ClientCredentials (loadClientCredentials)
import Strato.Auth.Token (defaultTokenCachePath)
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

-- | Legacy single-vault entry point: connect to @url@ using the process-wide
-- default credentials and token cache.
runVaultM :: MonadIO m => String -> VaultM m a -> m a
runVaultM url f = do
  env <- liftIO $ newAuthEnv url
  runReaderT f env

-- | Run a 'VaultM' against a pre-built 'AuthEnv'. Use with 'newVaultAuthEnv' so
-- each component (sequencer vs. p2p/discover) authenticates with its own
-- identity to its own vault.
runVaultMWith :: AuthEnv -> VaultM m a -> m a
runVaultMWith env f = runReaderT f env

-- | Build the vault 'AuthEnv' for a component's role. 'Nothing' credentials
-- path falls back to the default process-wide credentials and token cache
-- (single-vault behavior); an explicit credentials path uses that identity,
-- with its token cached at the given path (defaulting to
-- 'defaultTokenCachePath' when unspecified).
newVaultAuthEnv :: MonadIO m => Int -> String -> Maybe FilePath -> Maybe FilePath -> m AuthEnv
newVaultAuthEnv timeoutSec url mCredsPath mTokenPath = liftIO $
  case mCredsPath of
    Nothing -> newAuthEnvWith timeoutSec url
    Just credsPath -> do
      creds <- loadClientCredentials credsPath
      newAuthEnvWithCreds timeoutSec url creds (fromMaybe defaultTokenCachePath mTokenPath)

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
