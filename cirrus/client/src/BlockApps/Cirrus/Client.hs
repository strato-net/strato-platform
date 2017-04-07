{-# LANGUAGE
    TypeApplications
#-}

module BlockApps.Cirrus.Client
  ( postContract
  , getSearch
  , getSearchContract
  , cirrusUrl
  ) where

import Data.Aeson
import Data.Proxy
import Data.Text (Text)
import Servant.API
import Servant.Client

import BlockApps.Cirrus.API
import BlockApps.Solidity.Xabi

postContract :: ContractDetails -> ClientM NoContent
getSearch :: ClientM Value
getSearchContract :: Text -> ClientM Value
postContract :<|> getSearch :<|> getSearchContract = client (Proxy @ API)

cirrusUrl :: BaseUrl
cirrusUrl = BaseUrl Http "tester11.eastus.cloudapp.azure.com" 80 "/cirrus"
