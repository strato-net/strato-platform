{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE UndecidableInstances #-}

{-# OPTIONS_GHC -fno-warn-orphans #-}

module Control.Monad.Composable.Vault
  ( VaultData (..)
  , VaultM
  , HasVault(..)
  , runVaultM
  , runNodeKeyM
  ) where

import Blockchain.EthConf.Model (EthConf (..), UrlConfig (..))
import Blockchain.Strato.Model.Secp256k1 (PrivateKey, derivePublicKey, deriveSharedKey, signMsg)
import Control.Monad.Composable.Base
import Control.Monad.Composable.Vault.NodeKeyFile (readNodeKeyFile)
import Control.Monad.IO.Class
import Control.Monad.Trans (MonadTrans (..))
import Data.ByteString (ByteString)
import qualified Data.ByteString as B
import Strato.Auth.Client (AuthEnv, newAuthEnv, runWithAuth)
import qualified Strato.Strato23.API.Types as VC
import qualified Strato.Strato23.Client as VC
import System.Exit (die)

-- | Where this process's node key is. 'RemoteVault' is the vault-wrapper
-- (shared or node-local), reached over OAuth; 'LocalKey' is the key itself,
-- loaded from the file 'nodeKeyFile' names (a @--localKey@ validator). No
-- 'Show' instance on purpose: the key must never reach a log line.
data VaultData
  = RemoteVault AuthEnv
  | LocalKey PrivateKey

type VaultM es = Eff (VaultData ': es)

-------------------------------------------------------------------
------------------------- TYPECLASSES -----------------------------
-------------------------------------------------------------------

-- This type class allows for the abstraction of common secp256k1 operations
--  in some monad that "has a vault" which stores the private key
--  In prod, this is the vault-wrapper, and we use its servant client,
--  or the key file of a --localKey validator
--  In tests, the private key is either in the monad, or a global key
class Monad m => HasVault m where
  sign :: ByteString -> m VC.Signature
  getPub :: m VC.PublicKey
  postKey :: m VC.PublicKey
  getShared :: VC.PublicKey -> m VC.SharedKey

-- | Run against the vault-wrapper at the given URL.
runVaultM :: String -> VaultM es a -> Eff es a
runVaultM url f = do
  env <- liftIO $ newAuthEnv url
  provide (RemoteVault env) f

-- | Run against whatever the node's configuration names: the key file when
-- 'nodeKeyFile' is set, the Vault at 'vaultUrl' otherwise. The file is read
-- and checked once, here; a missing, unreadable or malformed key ends the
-- process with a message naming the file, before anything else starts.
runNodeKeyM :: EthConf -> VaultM es a -> Eff es a
runNodeKeyM conf f = case nodeKeyFile (urlConfig conf) of
  Nothing -> runVaultM (vaultUrl (urlConfig conf)) f
  Just path -> do
    key <- liftIO $ readNodeKeyFile path >>= either (die . ("node key: " ++)) return
    provide (LocalKey key) f

instance (VaultData :> es) => HasVault (Eff es) where
  sign bs = accessEnv >>= \case
    RemoteVault env -> do
      result <- liftIO $ runWithAuth env (VC.postSignature Nothing (VC.MsgHash bs))
      either (error . show) return result
    LocalKey key
      | B.length bs == 32 -> return $ signMsg key bs
      | otherwise -> error $ "sign: the message hash must be 32 bytes, got " ++ show (B.length bs)

  getPub = accessEnv >>= \case
    RemoteVault env -> do
      result <- liftIO $ runWithAuth env (VC.getKey Nothing Nothing)
      either (error . show) return (fmap VC.unPubKey result)
    LocalKey key -> return $ derivePublicKey key

  -- A local key exists from setup or the process did not start: there is
  -- never one to create.
  postKey = accessEnv >>= \case
    RemoteVault env -> do
      result <- liftIO $ runWithAuth env (VC.postKey Nothing)
      either (error . show) return (fmap VC.unPubKey result)
    LocalKey key -> return $ derivePublicKey key

  getShared pub = accessEnv >>= \case
    RemoteVault env -> do
      result <- liftIO $ runWithAuth env (VC.getSharedKey Nothing True pub)
      either (error . show) return result
    LocalKey key -> return $ deriveSharedKey key pub

-- Lift HasVault through any MonadTrans
instance (HasVault m, MonadTrans t, Monad (t m)) => HasVault (t m) where
  sign = lift . sign
  getPub = lift getPub
  postKey = lift postKey
  getShared = lift . getShared
