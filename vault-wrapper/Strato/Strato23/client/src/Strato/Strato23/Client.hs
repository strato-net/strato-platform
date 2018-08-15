{-# LANGUAGE TypeApplications #-}

module Strato.Strato23.Client
  ( getPing
  , postKey
  , postSignature
  ) where

import           Servant.Client
import           Data.Proxy
import           Data.Text
import           Strato.Strato23.API

getPing :: ClientM String
getPing = client (Proxy @ GetPing)

postKey :: Maybe Text -> Maybe Text -> ClientM Address
postKey = client (Proxy @ PostKey)

postSignature :: Maybe Text -> Maybe Text -> UserData -> ClientM SignatureDetails
postSignature = client (Proxy @ PostSignature)
