{-# OPTIONS_GHC -fno-warn-orphans #-}

{-# LANGUAGE TypeApplications #-}

module BlockApps.Bloc21.Client
  ( getHomepage
  , getAddresses
  , getContracts
  , getContractsData
  , getContractsContract
  , getContractsState
  , getContractsFunctions
  , getContractsSymbols
  , getContractsStateMapping
  , getContractsStates
  , postContractsCompile
  , getSearchContract
  , getSearchContractState
  , getSearchContractStateReduced
  , getUsers
  , getUsersUser
  , postUsersUser
  , postUsersSend
  , postUsersContract
  , postUsersUploadList
  , postUsersContractMethod
  , postUsersSendList
  , postUsersContractMethodList
  ) where

import           Data.Map.Strict                  (Map)
import           Data.Proxy
import           Data.Text                        (Text)
import           Servant.Client

import           BlockApps.Bloc21.API
import           BlockApps.Ethereum
import           BlockApps.Solidity.SolidityValue
import           BlockApps.Solidity.Xabi
import           BlockApps.Strato.Types

getHomepage :: ClientM Homepage
getHomepage = client (Proxy @ GetHomepage)

getAddresses :: ClientM [Address]
getAddresses = client (Proxy @ GetAddresses)

getContracts :: ClientM GetContractsResponse
getContracts = client (Proxy @ GetContracts)

getContractsData :: ContractName -> ClientM [MaybeNamed Address]
getContractsData = client (Proxy @ GetContractsData)

getContractsContract
  :: ContractName -> MaybeNamed Address -> ClientM ContractDetails
getContractsContract = client (Proxy @ GetContractsContract)

getContractsState
  :: ContractName -> MaybeNamed Address -> ClientM (Map Text SolidityValue)
getContractsState = client (Proxy @ GetContractsState)

getContractsFunctions
  :: ContractName -> MaybeNamed Address -> ClientM [FunctionName]
getContractsFunctions = client (Proxy @ GetContractsFunctions)

getContractsSymbols
  :: ContractName -> MaybeNamed Address -> ClientM [SymbolName]
getContractsSymbols = client (Proxy @ GetContractsSymbols)

getContractsStateMapping
  :: ContractName
  -> MaybeNamed Address
  -> SymbolName
  -> Text
  -> ClientM (Map Text (Map Text SolidityValue))
getContractsStateMapping = client (Proxy @ GetContractsStateMapping)

getContractsStates :: ContractName -> ClientM [GetContractsStatesResponse]
getContractsStates = client (Proxy @ GetContractsStates)

postContractsCompile :: [PostCompileRequest] -> ClientM [PostCompileResponse]
postContractsCompile = client (Proxy @ PostContractsCompile)

getSearchContract :: ContractName -> ClientM [MaybeNamed Address]
getSearchContract = client (Proxy @ GetSearchContract)

getSearchContractState :: ContractName -> ClientM [SearchContractState]
getSearchContractState = client (Proxy @ GetSearchContractState)

getSearchContractStateReduced
  :: ContractName -> [Text] -> ClientM [SearchContractState]
getSearchContractStateReduced = client (Proxy @ GetSearchContractStateReduced)

getUsers :: ClientM [UserName]
getUsers = client (Proxy @ GetUsers)

getUsersUser :: UserName -> ClientM [Address]
getUsersUser = client (Proxy @ GetUsersUser)

postUsersUser :: UserName -> PostUsersUserRequest -> ClientM Address
postUsersUser = client (Proxy @ PostUsersUser)

postUsersSend
  :: UserName -> Address -> PostSendParameters -> ClientM PostTransaction
postUsersSend = client (Proxy @ PostUsersSend)

postUsersContract
  :: UserName -> Address -> PostUsersContractRequest -> ClientM Address
postUsersContract = client (Proxy @ PostUsersContract)

postUsersUploadList
  :: UserName
  -> Address
  -> UploadListRequest
  -> ClientM [PostUsersUploadListResponse]
postUsersUploadList = client (Proxy @ PostUsersUploadList)

postUsersContractMethod
  :: UserName
  -> Address
  -> ContractName
  -> Address
  -> PostUsersContractMethodRequest
  -> ClientM PostUsersContractMethodResponse
postUsersContractMethod = client (Proxy @ PostUsersContractMethod)

postUsersSendList
  :: UserName -> Address -> PostSendListRequest -> ClientM [PostSendListResponse]
postUsersSendList = client (Proxy @ PostUsersSendList)

postUsersContractMethodList
  :: UserName
  -> Address
  -> PostMethodListRequest
  -> ClientM [PostMethodListResponse]
postUsersContractMethodList = client (Proxy @ PostUsersContractMethodList)
