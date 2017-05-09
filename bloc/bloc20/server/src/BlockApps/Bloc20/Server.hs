{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE TypeOperators     #-}

module BlockApps.Bloc20.Server where

import           Control.Lens             ((&), (.~), (?~))
import           Data.Proxy
import           Data.Swagger
--import           Network.Wai.Middleware.Cors
--import           Network.Wai.Middleware.RequestLogger
import           Servant
import           Servant.Swagger
import           Servant.Swagger.UI

import           BlockApps.Bloc20.API
import           BlockApps.Bloc20.Monad
import           BlockApps.Bloc20.Server.Addresses
import           BlockApps.Bloc20.Server.Contracts
import           BlockApps.Bloc20.Server.Search
import           BlockApps.Bloc20.Server.Users

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
    & info.version .~ "2.0"
    & info.description ?~ "This is the V2.0 API for the BlocH"
    & host ?~ Host "localhost" (Just 8000) -- this should not be hard coded
    & basePath ?~ "/bloc/v2.0"

type BlocDocsAPI = SwaggerSchemaUI "swagger-ui" "swagger.json"

serveBlocAndDocs
  :: BlocEnv
  -> Server (BlocAPI :<|> BlocDocsAPI)
serveBlocAndDocs blocEnv = serveBloc blocEnv
  :<|> swaggerSchemaUIServer blocSwagger

--appBloc :: BlocEnv -> Application
--appBloc
--  = simpleCors
--  . logStdoutDev
--  . serve (Proxy @ (BlocAPI :<|> BlocDocsAPI))
--  . serveBlocAndDocs
