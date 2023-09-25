{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Strato.Strato23.Server.User
  ( getUsers,
    getUsers',
  )
where

import BlockApps.Logging
import Data.Int
import Data.Text hiding (map)
import Strato.Strato23.API
import Strato.Strato23.Database.Queries
import Strato.Strato23.Monad

getUsers :: Text -> Maybe Address -> Maybe Int -> Maybe Int -> VaultM [User]
getUsers headerUsername mAddr mLimit mOffset = do
  $logDebugLS "getUsers" (headerUsername, mAddr, mOffset, mLimit)
  exists <- (> 0) <$> (vaultQuery1 (countUsers headerUsername) :: VaultM Int64)
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

getUsers' :: Text -> Text -> Maybe Address -> Maybe Int -> Maybe Int -> VaultM [User]
getUsers' headerUsername oauth mAddr mLimit mOffset = do
  $logDebugLS "getUsers" (headerUsername, oauth, mAddr, mOffset, mLimit)
  exists <- (> 0) <$> (vaultQuery1 (countUsers' headerUsername oauth) :: VaultM Int64)
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
