{-# LANGUAGE TypeApplications #-}

module BlockApps.VaultWrapper.Client
  ( getPing
  , postKey
  , postSignature
  ) where

import           Data.Proxy
import           Data.Text                    (Text)
import           Servant.API
import           Servant.Client

import           BlockApps.Ethereum           (Address(..))
import           BlockApps.VaultWrapper.API
import           BlockApps.VaultWrapper.Types

getPing :: ClientM String
postKey :: Maybe Text -> Maybe Text -> ClientM Address
postSignature :: Maybe Text -> Maybe Text -> UserData -> ClientM SignatureDetails
getPing :<|> postKey :<|> postSignature = client (Proxy @ API)
