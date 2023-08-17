{-# LANGUAGE TypeApplications #-}

module Bloc.Client
  ( getGitInfo,
    postUsersFill,
    createCertificate,
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
    postBlocTransactionExternal,
    postChainInfo,
    getSingleChainInfo,
    postChainInfos,
    getChainInfo,
    postBlocTransactionParallel,
    postBlocTransactionRaw,
    postBlocTransactionBody,
    postBlocTransactionUnsigned,
  )
where

import Bloc.API
import BlockApps.X509.Certificate
-- import BlockApps.Solidity.Xabi
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainId
import Blockchain.Strato.Model.Keccak256
import Data.Proxy
import Data.Text
import Servant.Client
import SolidVM.Model.CodeCollection.Contract

getGitInfo :: ClientM GitInfo
getGitInfo = client (Proxy @GetGitInfo)

------------- /users endpoints -------------
postUsersFill :: JwtToken -> Address -> Bool -> ClientM BlocTransactionResult
postUsersFill = client (Proxy @PostUsersFill)

------------- /x509 endpoints -------------
createCertificate :: Text -> CreateCertEndpoint -> ClientM X509Certificate
createCertificate = client (Proxy @CreateCertificate)

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

postBlocTransactionResults :: Bool -> [Keccak256] -> ClientM [BlocTransactionResult]
postBlocTransactionResults = client (Proxy @PostBlocTransactionResults)

------------- /chain(s) endpoints -------------
postChainInfo :: Maybe Text -> ChainInput -> ClientM ChainId
postChainInfo = client (Proxy @PostChainInfo)

getSingleChainInfo :: ChainId -> ClientM ChainIdChainOutput
getSingleChainInfo = client (Proxy @GetSingleChainInfo)

postChainInfos :: Maybe Text -> [ChainInput] -> ClientM [ChainId]
postChainInfos = client (Proxy @PostChainInfos)

getChainInfo ::
  [ChainId] ->
  Maybe Text ->
  Maybe Integer ->
  Maybe Integer ->
  ClientM [ChainIdChainOutput]
getChainInfo = client (Proxy @GetChainInfo)

------------- /transaction endpoints -------------
postBlocTransactionParallel ::
  Maybe Text ->
  Maybe ChainId ->
  Bool ->
  Bool ->
  PostBlocTransactionRequest ->
  ClientM [BlocChainOrTransactionResult]
postBlocTransactionParallel = client (Proxy @PostBlocTransactionParallel)

postBlocTransactionRaw ::
  Maybe Text ->
  Maybe ChainId ->
  Bool ->
  Bool ->
  PostBlocTransactionRawRequest ->
  ClientM BlocChainOrTransactionResult
postBlocTransactionRaw = client (Proxy @PostBlocTransactionRaw)

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
  Bool ->
  PostBlocTransactionRequest ->
  ClientM [BlocChainOrTransactionResult]
postBlocTransaction = client (Proxy @PostBlocTransaction)

postBlocTransactionExternal ::
  Maybe Text ->
  Maybe ChainId ->
  Bool ->
  PostBlocTransactionRequest ->
  ClientM [BlocChainOrTransactionResult]
postBlocTransactionExternal = client (Proxy @PostBlocTransactionExternal)
