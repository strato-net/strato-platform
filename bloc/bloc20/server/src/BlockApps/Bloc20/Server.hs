{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE TypeOperators     #-}

module BlockApps.Bloc20.Server where

import           Control.Lens             ((&), (.~), (?~))
import           Data.Proxy
import           Data.Swagger
import           Servant
import           Servant.Swagger

import           BlockApps.Bloc20.API
import           BlockApps.Bloc20.Monad
import           BlockApps.Bloc20.Server.Addresses
import           BlockApps.Bloc20.Server.Contracts
import           BlockApps.Bloc20.Server.Git
import           BlockApps.Bloc20.Server.Search
import           BlockApps.Bloc20.Server.Users

bloc :: ServerT BlocAPI Bloc
bloc = getHomepage
  :<|> getGitInfo
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

blocSwagger :: FilePath -> Swagger
blocSwagger path = toSwagger (Proxy @BlocAPI)
    & info.title   .~ "Bloc API"
    & info.version .~ "2.0"
    & info.description ?~ "This is the V2.0 API for the BlocH"
    & basePath .~ if null path then Nothing else Just path

type BlocDocsAPI = "swagger.json" :> Get '[JSON] Swagger

serveBlocAndDocs
  :: BlocEnv
  -> FilePath
  -> Server (BlocAPI :<|> BlocDocsAPI)
serveBlocAndDocs blocEnv path = serveBloc blocEnv
  :<|> return (blocSwagger path)
