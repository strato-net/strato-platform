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
  , getRemovePendingAddress
  , getContractFunctions
  , getContractSymbols
  , getContractStateMapping
  , getContractStates
  , postContractCompile
  , getSearchContract
  , getSearchContractState
  , getSearchContractStateReduced
  , postSendList
  , blocDev
  ) where

-- import Data.Aeson
import Data.Proxy
import Data.Text (Text)
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
getRemovePendingAddress :: Address -> Int -> ClientM NoContent
getContractFunctions :: ContractName -> Address -> ClientM [FunctionName]
getContractSymbols :: ContractName -> Address -> ClientM [SymbolName]
getUsers = client (Proxy @ GetUsers)
postUser = client (Proxy @ PostUser)
getUserAddresses = client (Proxy @ GetUserAddresses)
postSend = client (Proxy @ PostSend)
getContracts = client (Proxy @ GetContracts)
getContractData = client (Proxy @ GetContractData)
postContract = client (Proxy @ PostContract)
postUploadList = client (Proxy @ PostUploadList)
getContract = client (Proxy @ GetContract)
getContractState = client (Proxy @ GetContractState)
postContractMethod = client (Proxy @ PostContractMethod)
getAddresses = client (Proxy @ GetAddresses)
getAddressPending = client (Proxy @ GetAddressPending)
getRemovePendingAddress = client (Proxy @ GetRemovePendingAddress)
getContractFunctions = client (Proxy @ GetContractFunctions)
getContractSymbols = client (Proxy @ GetContractSymbols)

getContractStateMapping
  :: ContractName
  -> Address
  -> SymbolName
  -> Text
  -> ClientM GetContractStateMappingResponse
getContractStateMapping = client (Proxy @ GetContractStateMapping)

getContractStates :: ContractName -> ClientM UnstructuredJSON
getContractStates = client (Proxy @ GetContractStates)

postContractCompile :: [PostCompileRequest] -> ClientM [PostCompileResponse]
postContractCompile = client (Proxy @ PostContractCompile)

getSearchContract :: ContractName -> ClientM UnstructuredJSON
getSearchContract = client (Proxy @ GetSearchContract)

getSearchContractState :: ContractName -> ClientM [SearchContractState]
getSearchContractState = client (Proxy @ GetSearchContractState)

getSearchContractStateReduced :: ContractName -> [Text] -> ClientM [SearchContractState]
getSearchContractStateReduced = client (Proxy @ GetSearchContractStateReduced)

postSendList :: UserName -> Address -> PostSendListRequest -> ClientM [PostSendListResponse]
postSendList = client (Proxy @ PostSendList)

blocDev :: BaseUrl
blocDev = BaseUrl Http "tester8.centralus.cloudapp.azure.com" 80 "/bloc"
