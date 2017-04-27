{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE TypeOperators     #-}

module BlockApps.Bloc.Server where

import           Control.Lens             ((&), (.~), (?~))
import           Data.Proxy
import           Data.Swagger
import           Servant
import           Servant.Swagger
import           Servant.Swagger.UI

import           BlockApps.Bloc.API
import           BlockApps.Bloc.Monad
import           BlockApps.Bloc.Server.Addresses
import           BlockApps.Bloc.Server.Contracts
import           BlockApps.Bloc.Server.Search
import           BlockApps.Bloc.Server.Users

bloc :: ServerT BlocAPI Bloc
bloc = getHomepage
  :<|> getUsers
  :<|> postUsersUser
  :<|> getUsersUser
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
  :<|> getContractsFunctions
  :<|> getContractsSymbols
  :<|> getContractsStateMapping
  :<|> getContractsStates
  :<|> postContractsCompile
  :<|> getSearchContract
  :<|> getSearchContractState
  :<|> getSearchContractStateReduced

getHomepage :: Bloc Homepage
getHomepage = return whoWouldveThoughtThisIsActuallyTheHomepage

serveBloc :: BlocEnv -> Server BlocAPI
serveBloc env = enter (NT (enterBloc env)) bloc

blocSwagger :: Swagger
blocSwagger = toSwagger (Proxy @BlocAPI)
    & info.title   .~ "Bloc API"
    & info.version .~ "0.1"
    & info.description ?~ "This is the API for the BlocH"
    & host ?~ Host "localhost" (Just 8000)

type BlocDocsAPI = SwaggerSchemaUI "swagger-ui" "swagger.json"

serveBlocAndDocs
  :: BlocEnv
  -> Server (BlocAPI :<|> BlocDocsAPI)
serveBlocAndDocs blocEnv = serveBloc blocEnv
  :<|> swaggerSchemaUIServer blocSwagger

appBloc :: BlocEnv -> Application
appBloc = serve (Proxy @ (BlocAPI :<|> BlocDocsAPI)) . serveBlocAndDocs
