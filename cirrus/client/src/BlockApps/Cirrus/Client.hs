{-# LANGUAGE
    DeriveGeneric
  , RecordWildCards
  , TypeApplications
#-}

module BlockApps.Cirrus.Client
  ( postContract
  , getSearch
  , getSearchContract
  , cirrusUrl
  ) where

import Data.Proxy
import Data.Text (Text)
import Servant.API
import Servant.Client

import BlockApps.Cirrus.API
import BlockApps.Solidity.Xabi

postContract :: ContractDetails -> ClientM NoContent
getSearch :: ClientM [ContractDetails]
getSearchContract :: Text -> ClientM ContractDetails
postContract :<|> getSearch :<|> getSearchContract = client (Proxy @ API)

cirrusUrl :: BaseUrl
cirrusUrl = BaseUrl Http "bayar4a.eastus.cloudapp.azure.com" 80 "/cirrus"
