{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
module Strato.VaultProxy.Server.User
  ( getUsers
  ) where

-- import Data.Int
import Data.Text hiding (map)

-- import BlockApps.Logging
import Strato.VaultProxy.API
import Strato.VaultProxy.Monad

--Replace with the bouncer
getUsers :: Text -> Maybe Address -> Maybe Int -> Maybe Int -> VaultProxyM [User]
-- getUsers headerUsername mAddr mLimit mOffset = pure undefined
getUsers headerUsername mAddr mLimit mOffset = do
  mgr <- ask httpManager
  url <- ask vaultUrl
  clientEnv <- mkClientEnv mgr url
  kii <- runClientM (getUsers headerUsername mAddr mLimit mOffset) clientEnv --TODO: need to figure out how to pass the vaultproxy config to this function instead of clientEnv
  key <- case kii of
    Left err -> error $ "Error connecting to the shared vault: " ++ show err
    Right k -> return k
  pure key

  -- do
  --  $logDebugLS "getUsers" (headerUsername, mAddr, mOffset, mLimit)
  --  exists <- (>0) <$> (vaultQuery1 (countUsers headerUsername) :: VaultProxyM Int64)
  --  $logDebugLS "getUsers/count" exists
  --  if not exists
  --    then vaultProxyError $ UserDoesNotExist headerUsername
  --    else case mAddr of
  --          Just addr -> do
  --            uname <- vaultQuery1 $ getUserByAddress addr
  --            return [User uname addr]
  --          Nothing -> do
  --            users <- vaultQuery $ getUserAddresses mOffset mLimit
  --            return $ map (uncurry User) users
