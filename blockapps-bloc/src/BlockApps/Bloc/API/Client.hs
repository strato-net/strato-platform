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
  , postUploadList
  , getContract
  , getContractState
  , postContractMethod
  , getAddresses
  , getAddressPending
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
postUploadList :: UserName -> Address -> UploadList -> ClientM UnstructuredJSON
getContract :: ContractName -> Address -> ClientM UnstructuredJSON
getContractState :: ContractName -> Address -> ClientM UnstructuredJSON
postContractMethod
  :: UserName
  -> Address
  -> ContractName
  -> Address
  -> ClientM NoContent
getAddresses :: ClientM [Address]
getAddressPending :: Address -> ClientM NoContent
getUsers
  :<|> postUser
  :<|> getUserAddresses
  :<|> postSend
  :<|> getContracts
  :<|> getContractData
  :<|> postContract
  :<|> postUploadList
  :<|> getContract
  :<|> getContractState
  :<|> postContractMethod
  :<|> getAddresses
  :<|> getAddressPending = client (Proxy @ BlocAPI)

blocDev :: BaseUrl
blocDev = BaseUrl Http "tester8.centralus.cloudapp.azure.com" 80 "/bloc"
