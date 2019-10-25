{-# LANGUAGE TypeApplications #-}

module Strato.Strato23.Client
  ( getPing
  , getKey
  , getUsers
  , postKey
  , postSignature
  , postPassword
  , verifyPassword
  ) where

import           Servant.Client
import           Data.Proxy
import           Data.Text
import           Strato.Strato23.API

getPing :: ClientM String
getPing = client (Proxy @ GetPing)

getKey :: Text -> Maybe Text -> ClientM StatusAndAddress
getKey = client (Proxy @ GetKey)

getUsers :: Text -> Maybe Address -> Maybe Int -> Maybe Int -> ClientM [User]
getUsers = client (Proxy @ GetUsers)

postKey :: Text -> ClientM StatusAndAddress
postKey = client (Proxy @ PostKey)

postSignature :: Text -> UserData -> ClientM SignatureDetails
postSignature = client (Proxy @ PostSignature)

postPassword :: Text -> ClientM ()
postPassword = client (Proxy @ PostPassword)

verifyPassword :: ClientM ()
verifyPassword = client (Proxy @ VerifyPassword)
