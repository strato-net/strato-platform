{-# LANGUAGE
    TypeApplications
#-}

module BlockApps.Bloc.API.Client
  ( getUsers
  , postUsers
  , getUserAddresses
  , postSend
  , getContracts
  , postContract
  , getContract
  , getContractState
  , postContractMethod
  , getAddresses
  , blocDev
  ) where

import Data.Aeson
import Data.Proxy
import Data.Text
import Servant.API
import Servant.Client

import BlockApps.Bloc.API
import BlockApps.Strato.Types

getUsers :: ClientM [Value]
postUsers :: Value -> ClientM Value
getUserAddresses :: Text -> ClientM [Value]
postSend :: Text -> Address -> Value -> ClientM Value
getContracts :: Text -> ClientM [Value]
postContract :: Text -> Address -> Value -> ClientM Value
getContract :: Text -> Address -> ClientM Value
getContractState :: Text -> Address -> ClientM Value
postContractMethod :: Text -> Address -> Text -> Address -> ClientM NoContent
getAddresses :: ClientM [Value]
getUsers
  :<|> postUsers
  :<|> getUserAddresses
  :<|> postSend
  :<|> getContracts
  :<|> postContract
  :<|> getContract
  :<|> getContractState
  :<|> postContractMethod
  :<|> getAddresses = client (Proxy @ API)

blocDev :: BaseUrl
blocDev = BaseUrl Http "tester12.westus.cloudapp.azure.com/" 80 "/bloc"
