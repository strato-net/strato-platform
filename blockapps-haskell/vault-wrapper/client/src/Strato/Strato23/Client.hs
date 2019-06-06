{-# LANGUAGE TypeApplications #-}

module Strato.Strato23.Client
  ( getPing
  , getKey
  , postKey
  , postSignature
  , postPassword
  ) where

import           Servant.Client
import           Data.Proxy
import           Data.Text
import           Strato.Strato23.API

getPing :: ClientM String
getPing = client (Proxy @ GetPing)

getKey :: Text -> Maybe Text -> ClientM StatusAndAddress
getKey = client (Proxy @ GetKey)

postKey :: Text -> ClientM StatusAndAddress
postKey = client (Proxy @ PostKey)

postSignature :: Text -> UserData -> ClientM SignatureDetails
postSignature = client (Proxy @ PostSignature)

postPassword :: Text -> ClientM ()
postPassword = client (Proxy @ PostPassword)
