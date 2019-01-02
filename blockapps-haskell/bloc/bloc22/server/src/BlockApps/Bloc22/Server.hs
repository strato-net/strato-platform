{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE TypeOperators     #-}

module BlockApps.Bloc22.Server where

import           Control.Lens             ((&), (.~), (?~), over, makeLenses)
import           Data.HashMap.Strict.InsOrd
import           Data.Proxy
import           Data.Swagger
import           Servant
import           Servant.Swagger

import           BlockApps.Bloc22.API
import           BlockApps.Bloc22.Monad
import           BlockApps.Bloc22.Server.Addresses
import           BlockApps.Bloc22.Server.Chain
import           BlockApps.Bloc22.Server.Contracts
import           BlockApps.Bloc22.Server.Search
import           BlockApps.Bloc22.Server.Transaction
import           BlockApps.Bloc22.Server.Users

bloc :: ServerT BlocAPI Bloc
bloc = return gitInfo
  :<|> getUsers
  :<|> postUsersUser
  :<|> getUsersUser
  :<|> getUsersKeyStore
  :<|> postUsersKeyStore
  :<|> postUsersFill
  :<|> postUsersSend
  :<|> postUsersContract
  :<|> postUsersUploadList
  :<|> postUsersContractMethod
  :<|> postUsersSendList
  :<|> postUsersContractMethodList
  :<|> getAddresses
  :<|> getContracts
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
  :<|> getSearchContract
  :<|> getBlocTransactionResult
  :<|> postBlocTransactionResults
  :<|> postChainInfo
  :<|> getChainInfo
  :<|> postBlocTransaction

serveBloc :: BlocEnv -> Server BlocAPI
serveBloc env = hoistServer blocApi (enterBloc env) bloc

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
