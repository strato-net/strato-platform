{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE TypeOperators     #-}

module BlockApps.Bloc22.Server where

import           Control.Lens             ((&), (.~), (?~), over, makeLenses)
import           Control.Monad.IO.Class
import           Data.HashMap.Strict.InsOrd
import           Data.Proxy
import           Data.Swagger
import           Servant
import           Servant.Swagger

import           BlockApps.Bloc22.API
import           BlockApps.Bloc22.Server.Chain
import           BlockApps.Bloc22.Server.Contracts
import           BlockApps.Bloc22.Server.Transaction
import           BlockApps.Bloc22.Server.Users

import Control.Monad.Logger

import BlockApps.Bloc22.Monad

import Control.Monad.Composable.BlocSQL
import Control.Monad.Composable.CoreAPI
import Control.Monad.Composable.SQL
import Control.Monad.Composable.Vault

bloc :: (MonadIO m, MonadLogger m, HasBlocSQL m,
         HasBlocEnv m, HasVault m, HasCoreAPI m, HasSQL m) =>
        ServerT BlocAPI m
bloc = return gitInfo
  :<|> postUsersFill
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
  :<|> getChainInfo
  :<|> postChainInfos
  :<|> postBlocTransactionParallel
  :<|> postBlocTransaction

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
