{-# LANGUAGE
    TypeApplications
  , TypeFamilies
  , TypeOperators
#-}

module BlockApps.Bloc.Server where

import Data.Proxy
import Servant

import BlockApps.Bloc.Monad
import BlockApps.Bloc.Server.Users
import BlockApps.Bloc.Server.Addresses
import BlockApps.Bloc.Server.Contracts
import BlockApps.Bloc.Server.Search
import BlockApps.Bloc.API

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
serveBloc env = enter (NT (enterBloc env)) bloc

appBloc :: BlocEnv -> Application
appBloc = serve (Proxy @ BlocAPI) . serveBloc
