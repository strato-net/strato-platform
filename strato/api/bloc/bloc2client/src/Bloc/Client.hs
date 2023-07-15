{-# LANGUAGE TypeApplications #-}

module Bloc.Client 
    ( getGitInfo
    , postUsersFill
    , createCertificate
    , getContracts
    , postContractsBatchSeries
    , getContractsData
    , getContractsContract
    , getContractsState
    , getContractsDetails
    , postBlocTransaction
    )
where

import Bloc.API
import Servant.Client

import Data.Proxy
import Data.Text
import BlockApps.X509.Certificate
import BlockApps.Solidity.Xabi
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainId

getGitInfo :: ClientM GitInfo
getGitInfo = client (Proxy @GetGitInfo)

------------- /users endpoints -------------
postUsersFill :: JwtToken -> Address -> Bool -> ClientM BlocTransactionResult
postUsersFill = client (Proxy @PostUsersFill)

------------- /x509 endpoints -------------
createCertificate :: Text -> CreateCertEndpoint -> ClientM X509Certificate
createCertificate = client (Proxy @CreateCertificate)

------------- /contracts endpoints -------------
getContracts :: Maybe Integer 
             -> Maybe Integer 
             -> Maybe ChainId 
             -> ClientM GetContractsResponse
getContracts = client (Proxy @GetContracts)

postContractsBatchSeries :: [PostContractsBatchStatesRequest]
                         -> ClientM [GetContractsStateResponses]
postContractsBatchSeries = client (Proxy @PostContractsBatchStates)

getContractsData :: ContractName -> ClientM [Address]
getContractsData = client (Proxy @GetContractsData)

getContractsContract :: ContractName
                     -> Address
                     -> Maybe ChainId 
                     -> ClientM ContractDetails
getContractsContract = client (Proxy @GetContractsContract)

getContractsState :: ContractName
                  -> Address 
                  -> Maybe ChainId 
                  -> Maybe Text
                  -> Maybe Integer
                  -> Maybe Integer
                  -> Bool
                  -> ClientM GetContractsStateResponses
getContractsState = client (Proxy @GetContractsState)

getContractsDetails :: Address -> Maybe ChainId -> ClientM ContractDetails
getContractsDetails = client (Proxy @GetContractsDetails)

postBlocTransaction :: Maybe Text 
                    -> Maybe ChainId 
                    -> Bool 
                    -> PostBlocTransactionRequest
                    -> ClientM [BlocChainOrTransactionResult]
postBlocTransaction = client (Proxy @PostBlocTransaction)