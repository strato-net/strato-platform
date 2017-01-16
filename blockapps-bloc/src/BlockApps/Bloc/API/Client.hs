{-# LANGUAGE
    TypeApplications
#-}

module BlockApps.Bloc.API.Client
  ( getUsers
  , postUser
  , getUserAddresses
  , postSend
  , getContracts
  , getContractData
  , postContract
  -- , getContract
  -- , getContractState
  , postContractMethod
  , getAddresses
  , blocDev
  ) where

-- import Data.Aeson
import Data.Proxy
import Data.Text
import Servant.API
import Servant.Client

import BlockApps.Bloc.API
import BlockApps.Strato.Types

getUsers :: ClientM [Text]
postUser :: Text -> PostUserParameters -> ClientM Address
getUserAddresses :: Text -> ClientM [Address]
postSend :: Text -> Address -> PostSendParameters -> ClientM PostTransaction
getContracts :: ClientM Contracts
getContractData :: Text -> ClientM [Text]
postContract :: Text -> Address -> SrcPassword -> ClientM Keccak256
-- getContract :: Text -> Address -> ClientM Value
-- getContractState :: Text -> Address -> ClientM Value
postContractMethod :: Text -> Address -> Text -> Address -> ClientM NoContent
getAddresses :: ClientM [Address]
getUsers
  :<|> postUser
  :<|> getUserAddresses
  :<|> postSend
  :<|> getContracts
  :<|> getContractData
  :<|> postContract
  -- :<|> getContract
  -- :<|> getContractState
  :<|> postContractMethod
  :<|> getAddresses = client (Proxy @ API)

blocDev :: BaseUrl
blocDev = BaseUrl Http "tester8.centralus.cloudapp.azure.com" 80 "/bloc"
