module Strato.VaultProxy.Server.Ping where

import           Control.Monad.Trans.Reader
import           Strato.VaultProxy.Monad

getPing :: VaultProxyM String
getPing = do
  mgr <- ask httpManager 
  url <- ask vaultUrl
  clientEnv <- mkClientEnv mgr url
  kii <- runClientM (getPing) clientEnv --TODO: need to figure out how to pass the vaultproxy config to this function instead of clientEnv
  key <- case kii of
    Left err -> error $ "Error connecting to the shared vault: " ++ show err
    Right k -> return k
  pure key