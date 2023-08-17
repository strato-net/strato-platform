{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE TypeOperators     #-}

module Bloc.Server where

import           Control.Lens             ((&), (.~), (?~), over, makeLenses)
import           Data.HashMap.Strict.InsOrd
import           Data.Proxy
import           Data.Source.Map
import           Data.Swagger
import           Servant
import           Servant.Swagger

import           Bloc.API
import           Bloc.Server.Chain
import           Bloc.Server.Contracts
import           Bloc.Server.Transaction
import           Bloc.Server.TransactionResult
import           Bloc.Server.Users
import           Bloc.Server.X509

import Control.Monad.Change.Alter
import Control.Monad.Logger

import Bloc.Monad
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Keccak256
import Blockchain.Data.AddressStateDB
import Blockchain.DB.CodeDB

import Control.Monad.Composable.SQL
import Control.Monad.Composable.Vault

import SolidVM.Model.CodeCollection.Contract

bloc :: ( MonadLogger m
        , HasBlocEnv m
        , HasVault m
        , HasSQL m
        , Selectable Account Contract m
        , Selectable Account AddressState m
        , HasCodeDB m
        , (Keccak256 `Selectable` SourceMap) m
        )
     => ServerT BlocAPI m
bloc = return gitInfo
  :<|> postUsersFill
  :<|> createCertificate
  :<|> getContracts
  :<|> postContractsBatchStates
  :<|> getContractsData
  :<|> getContractsContract
  :<|> getContractsState
  :<|> getContractsDetails
  :<|> getContractsFunctions
  :<|> getContractsSymbols
  :<|> getContractsStateMapping
  :<|> getContractsStates
  :<|> getContractsEnum
  :<|> postContractsCompile
  :<|> postContractsXabi
  :<|> getBlocTransactionResult
  :<|> postBlocTransactionResults
  :<|> postChainInfo
  :<|> getSingleChainInfo
  :<|> postChainInfos
  :<|> getChainInfo
  :<|> postBlocTransactionParallel
  :<|> postBlocTransactionRaw
  :<|> postBlocTransactionBody
  :<|> postBlocTransactionUnsigned
  :<|> postBlocTransaction
  :<|> postBlocTransactionExternal

--serveBloc :: BlocEnv -> Server BlocAPI
--serveBloc env = hoistServer blocApi (enterBloc env) bloc

blocSwagger :: Swagger
blocSwagger = toSwagger (Proxy @BlocAPI)
    & info.title   .~ "Bloc API"
    & info.version .~ "2.2"
    & info.description ?~ "This is the V2.2 API for the BlocH"
    & basePath ?~ "/bloc/v2.2"

type BlocDocsAPI = "swagger.json" :> Get '[JSON] Swagger

makeLenses ''Swagger
filterEnterprisePaths :: Swagger -> Swagger
filterEnterprisePaths = over swaggerPaths $ filterWithKey (\k _ -> k /= "/users")