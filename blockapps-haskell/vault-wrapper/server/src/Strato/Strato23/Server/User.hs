{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
module Strato.Strato23.Server.User
  ( getUsers
  ) where

import Control.Monad.Except
import Data.Int
import Data.Text hiding (map)

import BlockApps.Logging
import Strato.Strato23.API
import Strato.Strato23.Monad
import Strato.Strato23.Database.Queries

getUsers :: Text -> Maybe Address -> Maybe Int -> Maybe Int -> VaultM [User]
getUsers headerUsername mAddr mLimit mOffset = do
  $logDebugLS "getUsers" (headerUsername, mAddr, mOffset, mLimit)
  exists <- (>0) <$> (vaultQuery1 (countUsers headerUsername) :: VaultM Int64)
  $logDebugLS "getUsers/count" exists
  if not exists
    then throwError $ UserDoesNotExist headerUsername
    else case mAddr of
           Just addr -> do
             uname <- vaultQuery1 $ getUserByAddress addr
             return [User uname addr]
           Nothing -> do
             users <- vaultQuery $ getUserAddresses mOffset mLimit
             return $ map (uncurry User) users
