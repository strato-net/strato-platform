{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE TypeOperators     #-}

module BlockApps.Bloc21.Server where

import           Control.Lens             ((&), (.~), (?~))
import           Data.Proxy
import           Data.Swagger
import           Servant
import           Servant.Swagger

import           BlockApps.Bloc21.API
import           BlockApps.Bloc21.Monad
import           BlockApps.Bloc21.Server.Addresses
import           BlockApps.Bloc21.Server.Contracts
import           BlockApps.Bloc21.Server.Git
import           BlockApps.Bloc21.Server.Search
import           BlockApps.Bloc21.Server.Users

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

blocSwagger :: FilePath -> Swagger
blocSwagger path = toSwagger (Proxy @BlocAPI)
    & info.title   .~ "Bloc API"
    & info.version .~ "2.1"
    & info.description ?~ "This is the V2.1 API for the BlocH"
    & basePath .~ if null path then Nothing else Just path

type BlocDocsAPI = "swagger.json" :> Get '[JSON] Swagger

serveBlocAndDocs
  :: BlocEnv
  -> FilePath
  -> Server (BlocAPI :<|> GetGitInfo :<|> BlocDocsAPI)
serveBlocAndDocs blocEnv path = serveBloc blocEnv
  :<|> getGitInfo
  :<|> return (blocSwagger path)
