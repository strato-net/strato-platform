{-# LANGUAGE
    TypeApplications
  , TypeOperators
#-}

module BlockApps.Bloc.API
  ( BlocAPI
  , markdownBloc
  , mockBloc
  , layoutBloc
  , bloc
  , serveBloc
  , appBloc
  , module Addresses
  , module Contracts
  , module Search
  , module Users
  , module Utils
  ) where

import BlockApps.Bloc.API.Addresses as Addresses
import BlockApps.Bloc.API.Contracts as Contracts
import BlockApps.Bloc.API.Search as Search
import BlockApps.Bloc.API.Users as Users
import BlockApps.Bloc.API.Utils as Utils
import BlockApps.Bloc.Monad

import Data.Proxy
import Data.Text (Text)
import Servant
import Servant.Docs
import Servant.Mock

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

bloc :: ServerT BlocAPI Bloc
bloc =
       getUsers
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

serveBloc :: BlocEnv -> Server BlocAPI
serveBloc env = enter (Nat (enterBloc env)) bloc

appBloc :: BlocEnv -> Application
appBloc = serve (Proxy @ BlocAPI) . serveBloc
