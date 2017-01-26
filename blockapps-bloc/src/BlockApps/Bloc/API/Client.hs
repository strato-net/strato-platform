{-# LANGUAGE
    TypeApplications
#-}

module BlockApps.Bloc.API.Client where

-- import Data.Aeson
import Data.Proxy
import Data.Text (Text)
import Network.HTTP.Client hiding (Proxy)
import Servant.API
import Servant.Client

import BlockApps.Bloc.API
import BlockApps.Strato.Types

getUsers :: ClientM [UserName]
getUsers = client (Proxy @ GetUsers)

getUsersUser :: UserName -> ClientM [Address]
getUsersUser = client (Proxy @ GetUsersUser)

postUsersUser :: UserName -> PostUsersUserRequest -> ClientM Address
postUsersUser = client (Proxy @ PostUsersUser)

postUsersSend :: UserName -> Address -> PostSendParameters -> ClientM PostTransaction
postUsersSend = client (Proxy @ PostUsersSend)

postUsersContract :: UserName -> Address -> SrcPassword -> ClientM Keccak256
postUsersContract = client (Proxy @ PostUsersContract)

postUsersUploadList :: UserName -> Address -> UploadList -> ClientM UnstructuredJSON
postUsersUploadList = client (Proxy @ PostUsersUploadList)

postUsersContractMethod :: UserName -> Address -> ContractName -> Address -> ClientM NoContent
postUsersContractMethod = client (Proxy @ PostUsersContractMethod)

postUsersSendList :: UserName -> Address -> PostSendListRequest -> ClientM [PostSendListResponse]
postUsersSendList = client (Proxy @ PostUsersSendList)

postUsersContractMethodList :: UserName -> Address -> PostMethodListRequest -> ClientM [PostMethodListResponse]
postUsersContractMethodList = client (Proxy @ PostUsersContractMethodList)

getAddresses :: ClientM [Address]
getAddresses = client (Proxy @ GetAddresses)

getAddressesPending :: Address -> ClientM NoContent
getAddressesPending = client (Proxy @ GetAddressesPending)

getAddressesPendingRemove :: Address -> Int -> ClientM NoContent
getAddressesPendingRemove = client (Proxy @ GetAddressesPendingRemove)

getContracts :: ClientM Contracts
getContracts = client (Proxy @ GetContracts)

getContractsData :: ContractName -> ClientM [Address]
getContractsData = client (Proxy @ GetContractsData)

getContractsContract :: ContractName -> Address -> ClientM UnstructuredJSON
getContractsContract = client (Proxy @ GetContractsContract)

getContractsState :: ContractName -> Address -> ClientM UnstructuredJSON
getContractsState = client (Proxy @ GetContractsState)

getContractsFunctions :: ContractName -> Address -> ClientM [FunctionName]
getContractsFunctions = client (Proxy @ GetContractsFunctions)

getContractsSymbols :: ContractName -> Address -> ClientM [SymbolName]
getContractsSymbols = client (Proxy @ GetContractsSymbols)

getContractsStateMapping :: ContractName -> Address -> SymbolName -> Text -> ClientM GetContractsStateMappingResponse
getContractsStateMapping = client (Proxy @ GetContractsStateMapping)

getContractsStates :: ContractName -> ClientM UnstructuredJSON
getContractsStates = client (Proxy @ GetContractsStates)

postContractsCompile :: [PostCompileRequest] -> ClientM [PostCompileResponse]
postContractsCompile = client (Proxy @ PostContractsCompile)

getSearchContract :: ContractName -> ClientM UnstructuredJSON
getSearchContract = client (Proxy @ GetSearchContract)

getSearchContractState :: ContractName -> ClientM [SearchContractState]
getSearchContractState = client (Proxy @ GetSearchContractState)

getSearchContractStateReduced :: ContractName -> [Text] -> ClientM [SearchContractState]
getSearchContractStateReduced = client (Proxy @ GetSearchContractStateReduced)

testerUrl :: BaseUrl
testerUrl = BaseUrl Http "tester12.westus.cloudapp.azure.com" 80 "/bloc"

testerClientEnv :: IO ClientEnv
testerClientEnv = do
  manager <- newManager defaultManagerSettings
  return $ ClientEnv manager testerUrl
