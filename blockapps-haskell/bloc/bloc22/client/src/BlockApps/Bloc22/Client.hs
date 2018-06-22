{-# OPTIONS_GHC -fno-warn-orphans #-}

{-# LANGUAGE TypeApplications #-}

module BlockApps.Bloc22.Client
  ( getHomepage
  , getGitInfo
  , getAddresses
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
  , getSearchContractState
  , getSearchContractStateReduced
  , getUsers
  , getUsersUser
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
  ) where

import           Data.LargeWord                   (Word256)
import           Data.Map.Strict                  (Map)
import           Data.Proxy
import           Data.Text                        (Text)
import           Servant.Client

import           BlockApps.Bloc22.API
import           BlockApps.Ethereum
import           BlockApps.Solidity.SolidityValue
import           BlockApps.Solidity.Xabi

getHomepage :: ClientM Homepage
getHomepage = client (Proxy @ GetHomepage)

getGitInfo :: ClientM GitInfo
getGitInfo = client (Proxy @ GetGitInfo)

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
  :: ContractName -> MaybeNamed Address -> Maybe Word256 -> Maybe Text -> Maybe Int -> Maybe Int -> Bool -> ClientM (Map Text SolidityValue)
getContractsState = client (Proxy @ GetContractsState)

getContractsDetails
  :: Address -> ClientM ContractDetails
getContractsDetails = client (Proxy @ GetContractsDetails)

getContractsFunctions
  :: ContractName -> MaybeNamed Address -> ClientM [FunctionName]
getContractsFunctions = client (Proxy @ GetContractsFunctions)

getContractsSymbols
  :: ContractName -> MaybeNamed Address -> ClientM [SymbolName]
getContractsSymbols = client (Proxy @ GetContractsSymbols)

--getContractsEnum
--  :: ContractName -> MaybeNamed Address -> EnumName -> ClientM [EnumValue]
--getContractsEnum = client (Proxy @ GetContractsEnum)

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

postContractsXabi :: PostXabiRequest -> ClientM PostXabiResponse
postContractsXabi = client (Proxy @ PostContractsXabi)

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

postUsersUser :: UserName -> Password -> ClientM Address
postUsersUser = client (Proxy @ PostUsersUser)

postUsersFill :: UserName -> Address -> Bool -> ClientM BlocTransactionResult
postUsersFill = client (Proxy @ PostUsersFill)

postUsersSend
  :: UserName -> Address -> Maybe Word256 -> Bool -> PostSendParameters -> ClientM BlocTransactionResult
postUsersSend = client (Proxy @ PostUsersSend)

postUsersContract
  :: UserName -> Address -> Maybe Word256 -> Bool -> PostUsersContractRequest -> ClientM BlocTransactionResult
postUsersContract = client (Proxy @ PostUsersContract)

postUsersUploadList
  :: UserName
  -> Address
  -> Maybe Word256
  -> Bool
  -> UploadListRequest
  -> ClientM [BlocTransactionResult]
postUsersUploadList = client (Proxy @ PostUsersUploadList)

postUsersContractMethod
  :: UserName
  -> Address
  -> ContractName
  -> Address
  -> Maybe Word256
  -> Bool
  -> PostUsersContractMethodRequest
  -> ClientM BlocTransactionResult
postUsersContractMethod = client (Proxy @ PostUsersContractMethod)

postUsersSendList
  :: UserName -> Address -> Maybe Word256 -> Bool -> PostSendListRequest -> ClientM [BlocTransactionResult]
postUsersSendList = client (Proxy @ PostUsersSendList)

postUsersContractMethodList
  :: UserName
  -> Address
  -> Maybe Word256
  -> Bool
  -> PostMethodListRequest
  -> ClientM [BlocTransactionResult]
postUsersContractMethodList = client (Proxy @ PostUsersContractMethodList)

getBlocTransactionResult :: Keccak256 -> Maybe Word256 -> Bool -> ClientM BlocTransactionResult
getBlocTransactionResult = client (Proxy @ GetBlocTransactionResult)

postBlocTransactionResults :: Maybe Word256 -> Bool -> [Keccak256] -> ClientM [BlocTransactionResult]
postBlocTransactionResults = client (Proxy @ PostBlocTransactionResults)
