{-# LANGUAGE TypeApplications #-}

module Strato.VaultProxy.Client
  ( getPing
  , getKey
  , postKey
  , getSharedKey
  , getUsers
  , postSignature
  , postPassword
  , verifyPassword
  , getCurrentUser
  , getRawToken
  ) where

import           Servant.Client
import           Data.Proxy
import           Data.Text
import           Strato.VaultProxy.API

getPing :: ClientM String
getPing = client (Proxy @ GetPing)

getKey :: Text -> Maybe Text -> ClientM AddressAndKey
getKey = client (Proxy @ GetKey)

postKey :: Text -> ClientM AddressAndKey
postKey = client (Proxy @ PostKey)

getSharedKey :: Text -> PublicKey -> ClientM SharedKey
getSharedKey = client (Proxy @ GetSharedKey)

getUsers :: Text -> Maybe Address -> Maybe Int -> Maybe Int -> ClientM [User]
getUsers = client (Proxy @ GetUsers)

postSignature :: Text -> MsgHash -> ClientM Signature
postSignature = client (Proxy @ PostSignature)

postPassword :: Text -> ClientM ()
postPassword = client (Proxy @ PostPassword)

verifyPassword :: ClientM Bool
verifyPassword = client (Proxy @ VerifyPassword)

getCurrentUser :: ClientM Text
getCurrentUser = client (Proxy @ GetCurrentUser)

getRawToken :: ClientM Text
getRawToken = client (Proxy @ GetRawToken)
