{-# LANGUAGE TypeApplications #-}

module Strato.Strato23.Client
  ( getPing
  , getKey
  , postKey
  , postSignature
  ) where

import           Servant.Client
import           Data.Proxy
import           Data.Text
import           Strato.Strato23.API

getPing :: ClientM String
getPing = client (Proxy @ GetPing)

getKey :: Text -> Text -> Maybe Text -> ClientM StatusAndAddress
getKey = client (Proxy @ GetKey)

postKey :: Text -> Text -> ClientM StatusAndAddress
postKey = client (Proxy @ PostKey)

postSignature :: Text -> Text -> UserData -> ClientM SignatureDetails
postSignature = client (Proxy @ PostSignature)
