{-# LANGUAGE TypeApplications #-}

module Bloc.Client
  ( getGitInfo,
    getContracts,
    postContractsBatchSeries,
    getContractsData,
    getContractsContract,
    getContractsState,
    getContractsDetails,
    getContractsFunctions,
    getContractsSymbols,
    getContractsStateMapping,
    getContractsStates,
    getContractsEnum,
    postContractsCompile,
    postContractsXabi,
    getBlocTransactionResult,
    postBlocTransactionResults,
    postBlocTransactionResultsExternal,
    postBlocTransaction,
    postBlocTransactionParallelExternal,
    postBlocTransactionParallel,
    postBlocTransactionBody,
    postBlocTransactionUnsigned,
  )
where

import Bloc.API
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Keccak256
import Data.Proxy
import Data.Text
import Servant.Client
import SolidVM.Model.CodeCollection.Contract

getGitInfo :: ClientM GitInfo
getGitInfo = client (Proxy @GetGitInfo)

------------- /contracts endpoints -------------
getContracts ::
  Maybe Text ->
  Maybe Integer ->
  Maybe Integer ->
  ClientM GetContractsResponse
getContracts = client (Proxy @GetContracts)

postContractsBatchSeries ::
  [PostContractsBatchStatesRequest] ->
  ClientM [GetContractsStateResponses]
postContractsBatchSeries = client (Proxy @PostContractsBatchStates)

getContractsData :: ContractName -> ClientM [Address]
getContractsData = client (Proxy @GetContractsData)

getContractsContract ::
  ContractName ->
  Address ->
  ClientM Contract
getContractsContract = client (Proxy @GetContractsContract)

getContractsState ::
  ContractName ->
  Address ->
  Maybe Text ->
  Maybe Integer ->
  Maybe Integer ->
  Bool ->
  ClientM GetContractsStateResponses
getContractsState = client (Proxy @GetContractsState)

getContractsDetails :: Address -> ClientM Contract
getContractsDetails = client (Proxy @GetContractsDetails)

getContractsFunctions ::
  ContractName ->
  Address ->
  ClientM [FunctionName]
getContractsFunctions = client (Proxy @GetContractsFunctions)

getContractsSymbols ::
  ContractName ->
  Address ->
  ClientM [SymbolName]
getContractsSymbols = client (Proxy @GetContractsSymbols)

getContractsStateMapping ::
  ContractName ->
  Address ->
  SymbolName ->
  Text ->
  ClientM GetContractsStateMappingResponse
getContractsStateMapping = client (Proxy @GetContractsStateMapping)

getContractsStates :: ContractName -> ClientM [GetContractsStatesResponse]
getContractsStates = client (Proxy @GetContractsStates)

getContractsEnum ::
  ContractName ->
  Address ->
  EnumName ->
  ClientM [EnumValue]
getContractsEnum = client (Proxy @GetContractsEnum)

postContractsCompile :: [PostCompileRequest] -> ClientM [PostCompileResponse]
postContractsCompile = client (Proxy @PostContractsCompile)

postContractsXabi :: PostXabiRequest -> ClientM PostXabiResponse
postContractsXabi = client (Proxy @PostContractsXabi)

------------- /transactions endpoints -------------
getBlocTransactionResult :: Keccak256 -> Bool -> ClientM BlocTransactionResult
getBlocTransactionResult = client (Proxy @GetBlocTransactionResult)

postBlocTransactionResults :: Bool -> [Keccak256] -> ClientM [BlocTransactionResult]
postBlocTransactionResults = client (Proxy @PostBlocTransactionResults)

postBlocTransactionResultsExternal :: Maybe Text -> Bool -> [Keccak256] -> ClientM [BlocTransactionResult]
postBlocTransactionResultsExternal = client (Proxy @PostBlocTransactionResultsExternal)

------------- /transaction endpoints -------------
postBlocTransactionParallel ::
  Maybe String ->
  Bool ->
  PostBlocTransactionRequest ->
  ClientM [BlocTransactionResult]
postBlocTransactionParallel = client (Proxy @PostBlocTransactionParallel)

postBlocTransactionParallelExternal ::
  Maybe Text ->
  Maybe String ->
  Bool ->
  PostBlocTransactionRequest ->
  ClientM [BlocTransactionResult]
postBlocTransactionParallelExternal = client (Proxy @PostBlocTransactionParallelExternal)

postBlocTransactionBody ::
  PostBlocTransactionRequest ->
  ClientM [BlocTransactionBodyResult]
postBlocTransactionBody = client (Proxy @PostBlocTransactionBody)

postBlocTransactionUnsigned ::
  PostBlocTransactionRequest ->
  ClientM [BlocTransactionUnsignedResult]
postBlocTransactionUnsigned = client (Proxy @PostBlocTransactionUnsigned)

postBlocTransaction ::
  Maybe String ->
  Bool ->
  PostBlocTransactionRequest ->
  ClientM [BlocTransactionResult]
postBlocTransaction = client (Proxy @PostBlocTransaction)
