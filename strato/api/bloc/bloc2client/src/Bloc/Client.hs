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
    postBlocTransaction,
    postBlocTransactionParallelExternal,
    postBlocTransactionParallel,
    postBlocTransactionBody,
    postBlocTransactionUnsigned,
  )
where

import Bloc.API
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainId
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
  Maybe ChainId ->
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
  Maybe ChainId ->
  ClientM Contract
getContractsContract = client (Proxy @GetContractsContract)

getContractsState ::
  ContractName ->
  Address ->
  Maybe ChainId ->
  Maybe Text ->
  Maybe Integer ->
  Maybe Integer ->
  Bool ->
  ClientM GetContractsStateResponses
getContractsState = client (Proxy @GetContractsState)

getContractsDetails :: Address -> Maybe ChainId -> ClientM Contract
getContractsDetails = client (Proxy @GetContractsDetails)

getContractsFunctions ::
  ContractName ->
  Address ->
  Maybe ChainId ->
  ClientM [FunctionName]
getContractsFunctions = client (Proxy @GetContractsFunctions)

getContractsSymbols ::
  ContractName ->
  Address ->
  Maybe ChainId ->
  ClientM [SymbolName]
getContractsSymbols = client (Proxy @GetContractsSymbols)

getContractsStateMapping ::
  ContractName ->
  Address ->
  SymbolName ->
  Text ->
  Maybe ChainId ->
  ClientM GetContractsStateMappingResponse
getContractsStateMapping = client (Proxy @GetContractsStateMapping)

getContractsStates :: ContractName -> ClientM [GetContractsStatesResponse]
getContractsStates = client (Proxy @GetContractsStates)

getContractsEnum ::
  ContractName ->
  Address ->
  EnumName ->
  Maybe ChainId ->
  ClientM [EnumValue]
getContractsEnum = client (Proxy @GetContractsEnum)

postContractsCompile :: [PostCompileRequest] -> ClientM [PostCompileResponse]
postContractsCompile = client (Proxy @PostContractsCompile)

postContractsXabi :: PostXabiRequest -> ClientM PostXabiResponse
postContractsXabi = client (Proxy @PostContractsXabi)

------------- /transactions endpoints -------------
getBlocTransactionResult :: Keccak256 -> Bool -> ClientM BlocTransactionResult
getBlocTransactionResult = client (Proxy @GetBlocTransactionResult)

postBlocTransactionResults :: Maybe Text -> Bool -> [Keccak256] -> ClientM [BlocTransactionResult]
postBlocTransactionResults = client (Proxy @PostBlocTransactionResults)

------------- /transaction endpoints -------------
postBlocTransactionParallel ::
  Maybe Text ->
  Maybe ChainId ->
  Maybe Bool ->
  Bool ->
  Bool ->
  PostBlocTransactionRequest ->
  ClientM [BlocChainOrTransactionResult]
postBlocTransactionParallel = client (Proxy @PostBlocTransactionParallel)

postBlocTransactionParallelExternal ::
  Maybe Text ->
  Maybe ChainId ->
  Maybe Bool ->
  Bool ->
  Bool ->
  PostBlocTransactionRequest ->
  ClientM [BlocChainOrTransactionResult]
postBlocTransactionParallelExternal = client (Proxy @PostBlocTransactionParallelExternal)

postBlocTransactionBody ::
  Maybe Text ->
  Maybe ChainId ->
  PostBlocTransactionRequest ->
  ClientM [BlocTransactionBodyResult]
postBlocTransactionBody = client (Proxy @PostBlocTransactionBody)

postBlocTransactionUnsigned ::
  Maybe Text ->
  Maybe ChainId ->
  PostBlocTransactionRequest ->
  ClientM [BlocTransactionUnsignedResult]
postBlocTransactionUnsigned = client (Proxy @PostBlocTransactionUnsigned)

postBlocTransaction ::
  Maybe Text ->
  Maybe ChainId ->
  Maybe Bool ->
  Bool ->
  PostBlocTransactionRequest ->
  ClientM [BlocChainOrTransactionResult]
postBlocTransaction = client (Proxy @PostBlocTransaction)
