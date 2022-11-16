{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
module Strato.VaultProxy.Server.User
  ( getUsers
  ) where

import Data.Int
import Data.Text hiding (map)

import BlockApps.Logging
import Strato.VaultProxy.API
import Strato.VaultProxy.Monad
import Strato.VaultProxy.Database.Queries

getUsers :: Text -> Maybe Address -> Maybe Int -> Maybe Int -> VaultM [User]
getUsers headerUsername mAddr mLimit mOffset = do
  $logDebugLS "getUsers" (headerUsername, mAddr, mOffset, mLimit)
  exists <- (>0) <$> (vaultQuery1 (countUsers headerUsername) :: VaultM Int64)
  $logDebugLS "getUsers/count" exists
  if not exists
    then vaultWrapperError $ UserDoesNotExist headerUsername
    else case mAddr of
           Just addr -> do
             uname <- vaultQuery1 $ getUserByAddress addr
             return [User uname addr]
           Nothing -> do
             users <- vaultQuery $ getUserAddresses mOffset mLimit
             return $ map (uncurry User) users
