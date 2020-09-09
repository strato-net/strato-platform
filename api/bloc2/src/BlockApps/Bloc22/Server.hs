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
--import           Control.Monad.Logger
import           Data.HashMap.Strict.InsOrd
import           Data.Proxy
import           Data.Swagger
import           Servant
import           Servant.Swagger

import           BlockApps.Bloc22.API
--import           BlockApps.Bloc22.Monad
import           BlockApps.Bloc22.Server.Chain
--import           BlockApps.Bloc22.Server.Contracts
--import           BlockApps.Bloc22.Server.Transaction
--import           BlockApps.Bloc22.Server.Users

import Control.Monad.Change.Alter
import Control.Monad.Logger
import Control.Monad.Trans.Control

import BlockApps.Bloc22.Monad
import Blockchain.Strato.Model.ChainId
import Blockchain.Data.ChainInfo

import Control.Monad.Composable.BlocSQL

bloc :: (MonadIO m, MonadBaseControl IO m, MonadLogger m, HasBlocSQL m, HasBlocEnv m,
         Selectable ChainId ChainInfo m) =>
        ServerT BlocAPI m
--bloc :: (MonadIO m, MonadLogger m, Selectable ChainId ChainInfo m) => ServerT BlocAPI m
bloc = return gitInfo
--  :<|> postUsersFill
--  :<|> getContracts
--  :<|> postContractsBatchStates
--  :<|> getContractsData
--  :<|> getContractsContract
--  :<|> getContractsState
--  :<|> getContractsDetails
--  :<|> getContractsFunctions
--  :<|> getContractsSymbols
--  :<|> getContractsStateMapping
--  :<|> getContractsStates
--  :<|> getContractsEnum
--  :<|> postContractsCompile
--  :<|> postContractsXabi
--  :<|> getBlocTransactionResult
--  :<|> postBlocTransactionResults
--  :<|> postChainInfo
  :<|> getChainInfo
  :<|> postChainInfos
--  :<|> postBlocTransactionParallel
--  :<|> postBlocTransaction

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
