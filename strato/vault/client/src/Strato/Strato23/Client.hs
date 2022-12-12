{-# LANGUAGE TypeApplications #-}

module Strato.Strato23.Client
  ( getPing
  , getKey
  , getKeys'
  , postKey
  , getSharedKey'
  , getUsers'
  , postSignature'
  , postPassword
  , verifyPassword
  ) where

import           Servant.Client
import           Data.Proxy
import           Data.Text
import           Strato.Strato23.API

getPing :: ClientM String
getPing = client (Proxy @ GetPing)

getKey :: Text -> Maybe Text -> Maybe Text -> ClientM AddressAndKey
getKey = client (Proxy @ GetKey)


getKeys' :: Text -> Text -> Maybe Text -> ClientM [AddressAndKey]
getKeys' = client (Proxy @ GetKeys')

postKey :: Text -> Maybe Text -> ClientM AddressAndKey
postKey = client (Proxy @ PostKey)

getSharedKey' :: Text -> Maybe Text -> PublicKey -> ClientM SharedKey
getSharedKey' = client (Proxy @ GetSharedKey)

getUsers' :: Text ->  Text -> Maybe Address -> Maybe Int -> Maybe Int -> ClientM [User] -- External Vault
getUsers' = client (Proxy @ GetUsers)

postSignature' :: Text -> Maybe Text ->  MsgHash -> ClientM Signature
postSignature' = client (Proxy @ PostSignature)

postPassword :: Text -> ClientM ()
postPassword = client (Proxy @ PostPassword)

verifyPassword :: ClientM Bool
verifyPassword = client (Proxy @ VerifyPassword)
