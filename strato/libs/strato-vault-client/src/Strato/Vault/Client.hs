module Strato.Vault.Client
  ( VaultEnv
  , newVaultEnv
  , runVault
  ) where

import Servant.Client (ClientM, ClientError)
import Strato.Auth.Client (AuthEnv, newAuthEnv, runWithAuth)

type VaultEnv = AuthEnv

newVaultEnv :: String -> IO VaultEnv
newVaultEnv = newAuthEnv

runVault :: VaultEnv -> ClientM a -> IO (Either ClientError a)
runVault = runWithAuth
