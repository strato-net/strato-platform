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

postUsersUser :: UserName -> PostUserParameters -> ClientM Address
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

getContracts :: ClientM Contracts
getContracts = client (Proxy @ GetContracts)

getContractData :: ContractName -> ClientM [Address]
getContractData = client (Proxy @ GetContractData)

getContract :: ContractName -> Address -> ClientM UnstructuredJSON
getContract = client (Proxy @ GetContract)

getContractState :: ContractName -> Address -> ClientM UnstructuredJSON
getContractState = client (Proxy @ GetContractState)

getAddresses :: ClientM [Address]
getAddresses = client (Proxy @ GetAddresses)

getAddressPending :: Address -> ClientM NoContent
getAddressPending = client (Proxy @ GetAddressPending)

getRemovePendingAddress :: Address -> Int -> ClientM NoContent
getRemovePendingAddress = client (Proxy @ GetRemovePendingAddress)

getContractFunctions :: ContractName -> Address -> ClientM [FunctionName]
getContractFunctions = client (Proxy @ GetContractFunctions)

getContractSymbols :: ContractName -> Address -> ClientM [SymbolName]
getContractSymbols = client (Proxy @ GetContractSymbols)

getContractStateMapping :: ContractName -> Address -> SymbolName -> Text -> ClientM GetContractStateMappingResponse
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

testerUrl :: BaseUrl
testerUrl = BaseUrl Http "tester12.westus.cloudapp.azure.com" 80 "/bloc"

testerClientEnv :: IO ClientEnv
testerClientEnv = do
  manager <- newManager defaultManagerSettings
  return $ ClientEnv manager testerUrl
