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
getUsers = pure undefined

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
