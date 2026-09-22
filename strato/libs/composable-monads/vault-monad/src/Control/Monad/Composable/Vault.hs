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
import Data.IORef (IORef, atomicModifyIORef', newIORef, readIORef)
import qualified Data.Map.Strict as Map
import Data.Map.Strict (Map)
import Strato.Auth.Client (AuthEnv, authEnvCacheKey, newAuthEnv, runWithAuth)
import qualified Strato.Strato23.API.Types as VC
import qualified Strato.Strato23.Client as VC
import System.IO.Unsafe (unsafePerformIO)

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

-- | Process-wide cache of the node's public key per vault identity (see
-- 'authEnvCacheKey'). An identity's key never changes once created, and p2p
-- asks for it on every handshake, so without this cache most vault traffic is
-- repeated key lookups. Only successful results are stored. It is process-wide
-- rather than per 'AuthEnv' because 'runVaultM' builds a fresh env per runner.
pubKeyCache :: IORef (Map String VC.PublicKey)
{-# NOINLINE pubKeyCache #-}
pubKeyCache = unsafePerformIO $ newIORef Map.empty

lookupPubKey :: AuthEnv -> IO (Maybe VC.PublicKey)
lookupPubKey env = Map.lookup (authEnvCacheKey env) <$> readIORef pubKeyCache

storePubKey :: AuthEnv -> VC.PublicKey -> IO ()
storePubKey env pub =
  atomicModifyIORef' pubKeyCache $ \cache -> (Map.insert (authEnvCacheKey env) pub cache, ())

instance {-# OVERLAPPING #-} MonadIO m => HasVault (VaultM m) where
  sign bs = do
    env <- ask
    result <- liftIO $ runWithAuth env (VC.postSignature Nothing (VC.MsgHash bs))
    either (error . show) return result

  getPub = do
    env <- ask
    cached <- liftIO $ lookupPubKey env
    case cached of
      Just pub -> return pub
      Nothing -> do
        result <- liftIO $ runWithAuth env (VC.getKey Nothing Nothing)
        pub <- either (error . show) (return . VC.unPubKey) result
        liftIO $ storePubKey env pub
        return pub

  postKey = do
    env <- ask
    result <- liftIO $ runWithAuth env (VC.postKey Nothing)
    pub <- either (error . show) (return . VC.unPubKey) result
    liftIO $ storePubKey env pub
    return pub

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
