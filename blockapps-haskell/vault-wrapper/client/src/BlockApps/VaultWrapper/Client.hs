{-# LANGUAGE TypeApplications #-}

module BlockApps.VaultWrapper.Client
  ( getPing
  , getKey
  , postKey
  , postSignature
  ) where

import           Data.Proxy
import           Data.Text                    (Text)
import           Servant.API
import           Servant.Client

import           BlockApps.VaultWrapper.API
import           BlockApps.VaultWrapper.Types

getPing :: ClientM String
getKey :: Maybe Text -> Maybe Text -> ClientM StatusAndAddress
postKey :: Maybe Text -> Maybe Text -> ClientM StatusAndAddress
postSignature :: Maybe Text -> Maybe Text -> UserData -> ClientM SignatureDetails
getPing :<|> getKey :<|> postKey :<|> postSignature = client (Proxy @ API)
