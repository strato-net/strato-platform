{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies     #-}
{-# LANGUAGE TypeOperators    #-}

module BlockApps.Bloc.Server where

import           Data.Proxy
import           Network.Wai.Middleware.RequestLogger
import           Servant

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

appBloc :: BlocEnv -> Application
appBloc = logStdoutDev . serve (Proxy @ BlocAPI) . serveBloc
