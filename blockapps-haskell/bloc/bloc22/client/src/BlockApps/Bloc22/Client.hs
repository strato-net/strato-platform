{-# OPTIONS_GHC -fno-warn-orphans #-}

{-# LANGUAGE TypeApplications #-}

module BlockApps.Bloc22.Client
  ( getGitInfo
  , getAddresses
  , postChainInfo
  , getChainInfo
  , getContracts
  , getContractsData
  , getContractsContract
  , getContractsState
  , getContractsDetails
  , getContractsFunctions
  , getContractsSymbols
  , getContractsStateMapping
  , getContractsStates
  , postContractsCompile
  , postContractsXabi
  , getSearchContract
  , getUsers
  , getUsersUser
  , getUsersKeyStore
  , postUsersKeyStore
  , postUsersUser
  , postUsersFill
  , postUsersSend
  , postUsersContract
  , postUsersUploadList
  , postUsersContractMethod
  , postUsersSendList
  , postUsersContractMethodList
  , getBlocTransactionResult
  , postBlocTransactionResults
  , postBlocTransaction
  ) where

import           Data.Map.Strict                  (Map)
import           Data.Proxy
import           Data.Text                        (Text)
import           Servant.Client

import           BlockApps.Bloc22.API
import           BlockApps.Bloc22.API.Chain
import           BlockApps.Bloc22.API.Transaction
import           BlockApps.Ethereum
import           BlockApps.Solidity.SolidityValue
import           BlockApps.Solidity.Xabi

getGitInfo :: ClientM GitInfo
getGitInfo = client (Proxy @ GetGitInfo)

getAddresses :: ClientM [Address]
getAddresses = client (Proxy @ GetAddresses)

getContracts :: ClientM GetContractsResponse
getContracts = client (Proxy @ GetContracts)

getContractsData :: ContractName -> ClientM [MaybeNamed Address]
getContractsData = client (Proxy @ GetContractsData)

getContractsContract
  :: ContractName -> MaybeNamed Address -> Maybe ChainId -> ClientM ContractDetails
getContractsContract = client (Proxy @ GetContractsContract)

getContractsState
  :: ContractName 
  -> MaybeNamed Address 
  -> Maybe ChainId
  -> Maybe Text 
  -> Maybe Int
  -> Maybe Int
  -> Bool
  -> ClientM (Map Text SolidityValue)
getContractsState = client (Proxy @ GetContractsState)

getContractsDetails
  :: Address -> Maybe ChainId -> ClientM ContractDetails
getContractsDetails = client (Proxy @ GetContractsDetails)

getContractsFunctions
  :: ContractName -> MaybeNamed Address -> Maybe ChainId -> ClientM [FunctionName]
getContractsFunctions = client (Proxy @ GetContractsFunctions)

getContractsSymbols
  :: ContractName -> MaybeNamed Address -> Maybe ChainId -> ClientM [SymbolName]
getContractsSymbols = client (Proxy @ GetContractsSymbols)

-- getContractsEnum
--   :: ContractName -> MaybeNamed Address -> EnumName -> Maybe ChainId -> ClientM [EnumValue]
-- getContractsEnum = client (Proxy @ GetContractsEnum)

getContractsStateMapping
  :: ContractName
  -> MaybeNamed Address
  -> SymbolName
  -> Text
  -> Maybe ChainId
  -> ClientM (Map Text (Map Text SolidityValue))
getContractsStateMapping = client (Proxy @ GetContractsStateMapping)

getContractsStates :: ContractName -> ClientM [GetContractsStatesResponse]
getContractsStates = client (Proxy @ GetContractsStates)

postContractsCompile :: [PostCompileRequest] -> ClientM [PostCompileResponse]
postContractsCompile = client (Proxy @ PostContractsCompile)

postContractsXabi :: PostXabiRequest -> ClientM PostXabiResponse
postContractsXabi = client (Proxy @ PostContractsXabi)

getSearchContract :: ContractName -> ClientM [Greedy (MaybeNamed Address) ChainId]
getSearchContract = client (Proxy @ GetSearchContract)

getUsers :: ClientM [UserName]
getUsers = client (Proxy @ GetUsers)

getUsersUser :: UserName -> ClientM [Address]
getUsersUser = client (Proxy @ GetUsersUser)

postUsersUser :: UserName -> Password -> ClientM Address
postUsersUser = client (Proxy @ PostUsersUser)

getUsersKeyStore :: UserName -> Address -> Password -> ClientM KeyStore
getUsersKeyStore = client (Proxy @ GetUsersKeyStore)

postUsersKeyStore :: UserName -> PostUsersKeyStoreRequest -> ClientM Bool
postUsersKeyStore = client (Proxy @ PostUsersKeyStore)

postUsersFill :: UserName -> Address -> Bool -> ClientM BlocTransactionResult
postUsersFill = client (Proxy @ PostUsersFill)

postUsersSend
  :: UserName -> Address -> Maybe ChainId -> Bool -> PostSendParameters -> ClientM BlocTransactionResult
postUsersSend = client (Proxy @ PostUsersSend)

postUsersContract
  :: UserName -> Address -> Maybe ChainId -> Bool -> PostUsersContractRequest -> ClientM BlocTransactionResult
postUsersContract = client (Proxy @ PostUsersContract)

postUsersUploadList
  :: UserName
  -> Address
  -> Maybe ChainId
  -> Bool
  -> UploadListRequest
  -> ClientM [BlocTransactionResult]
postUsersUploadList = client (Proxy @ PostUsersUploadList)

postUsersContractMethod
  :: UserName
  -> Address
  -> ContractName
  -> Address
  -> Maybe ChainId
  -> Bool
  -> PostUsersContractMethodRequest
  -> ClientM BlocTransactionResult
postUsersContractMethod = client (Proxy @ PostUsersContractMethod)

postUsersSendList
  :: UserName -> Address -> Maybe ChainId -> Bool -> PostSendListRequest -> ClientM [BlocTransactionResult]
postUsersSendList = client (Proxy @ PostUsersSendList)

postUsersContractMethodList
  :: UserName
  -> Address
  -> Maybe ChainId
  -> Bool
  -> PostMethodListRequest
  -> ClientM [BlocTransactionResult]
postUsersContractMethodList = client (Proxy @ PostUsersContractMethodList)

getBlocTransactionResult :: Keccak256 -> Maybe ChainId -> Bool -> ClientM BlocTransactionResult
getBlocTransactionResult = client (Proxy @ GetBlocTransactionResult)

postBlocTransactionResults :: Maybe ChainId -> Bool -> [Keccak256] -> ClientM [BlocTransactionResult]
postBlocTransactionResults = client (Proxy @ PostBlocTransactionResults)

postChainInfo :: ChainInput -> ClientM ChainId
postChainInfo = client (Proxy @ PostChainInfo)

getChainInfo :: [ChainId] -> ClientM [ChainIdChainOutput]
getChainInfo = client (Proxy @ GetChainInfo)

postBlocTransaction
  :: Maybe Text
  -> Maybe Text
  -> Maybe ChainId
  -> Bool
  -> PostBlocTransactionRequest
  -> ClientM [BlocTransactionResult]
postBlocTransaction = client (Proxy @ PostBlocTransaction)
