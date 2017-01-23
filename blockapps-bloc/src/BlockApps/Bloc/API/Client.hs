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
import Servant.API
import Servant.Client

import BlockApps.Bloc.API
import BlockApps.Strato.Types

getUsers :: ClientM [UserName]
postUser :: UserName -> PostUserParameters -> ClientM Address
getUserAddresses :: UserName -> ClientM [Address]
postSend
  :: UserName
  -> Address
  -> PostSendParameters
  -> ClientM PostTransaction
getContracts :: ClientM Contracts
getContractData :: ContractName -> ClientM [Address]
postContract :: UserName -> Address -> SrcPassword -> ClientM Keccak256
-- getContract :: ContractName -> Address -> ClientM Value
-- getContractState :: ContractName -> Address -> ClientM Value
postContractMethod
  :: UserName
  -> Address
  -> ContractName
  -> Address
  -> ClientM NoContent
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
  :<|> getAddresses = client (Proxy @ BlocAPI)

blocDev :: BaseUrl
blocDev = BaseUrl Http "tester8.centralus.cloudapp.azure.com" 80 "/bloc"
