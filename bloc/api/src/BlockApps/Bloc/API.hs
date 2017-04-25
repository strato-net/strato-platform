{-# OPTIONS_GHC -fno-warn-unused-binds #-}
{-# LANGUAGE
    TypeOperators
  , TypeApplications
  , DataKinds
  , OverloadedStrings
#-}

module BlockApps.Bloc.API
  (
    BlocAPI
  , module BlockApps.Bloc.API.Users
  , module BlockApps.Bloc.API.Addresses
  , module BlockApps.Bloc.API.Contracts
  , module BlockApps.Bloc.API.Search
  , module BlockApps.Bloc.API.Utils
  , module BlockApps.Bloc.Crypto
  ) where

import Control.Lens ((&), (.~), (?~))
import Data.Proxy
import Data.Swagger
import Data.Text
import Servant
import Servant.Docs
import Servant.Mock
import Servant.Swagger
import Servant.Swagger.UI

import BlockApps.Bloc.API.Users
import BlockApps.Bloc.API.Addresses
import BlockApps.Bloc.API.Contracts
import BlockApps.Bloc.API.Search
import BlockApps.Bloc.API.Utils
import BlockApps.Bloc.Crypto

type BlocAPI =
  -- /users endpoints
       GetUsers
  :<|> PostUsersUser
  :<|> GetUsersUser
  :<|> PostUsersSend
  :<|> PostUsersContract
  :<|> PostUsersUploadList
  :<|> PostUsersContractMethod
  :<|> PostUsersSendList
  :<|> PostUsersContractMethodList
  -- /address endpoints
  :<|> GetAddresses
  -- /contracts endpoints
  :<|> GetContracts
  :<|> GetContractsData
  :<|> GetContractsContract
  :<|> GetContractsState
  :<|> GetContractsFunctions
  :<|> GetContractsSymbols
  :<|> GetContractsStateMapping
  :<|> GetContractsStates
  :<|> PostContractsCompile
  -- /search endpoints
  :<|> GetSearchContract
  :<|> GetSearchContractState
  :<|> GetSearchContractStateReduced

markdownBloc :: String
markdownBloc = markdown $ docs (Proxy @ BlocAPI)

mockBloc :: Server BlocAPI
mockBloc = mock (Proxy @ BlocAPI) Proxy

layoutBloc :: Text
layoutBloc = layout (Proxy @ BlocAPI)

type SwaggerizedAPI = BlocAPI :<|> SwaggerSchemaUI "swagger-ui" "swagger.json"

blocApi :: Proxy BlocAPI
blocApi = Proxy

swaggerizedAPI :: Proxy SwaggerizedAPI
swaggerizedAPI = Proxy

iamSwagger :: Swagger
iamSwagger = toSwagger blocApi
    & info.title   .~ "Bloc API"
    & info.version .~ "0.1"
    & info.description ?~ "This is the API for the BlocH"
