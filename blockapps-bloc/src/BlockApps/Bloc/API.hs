{-# LANGUAGE
    TypeApplications
  , TypeOperators
#-}

module BlockApps.Bloc.API
  ( BlocAPI
  , markdownBloc
  , mockBloc
  , layoutBloc
  , serveBloc
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
  :<|> GetAddressesPending
  :<|> GetAddressesPendingRemove
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

serveBloc :: ServerT BlocAPI Bloc
serveBloc =
       serveGetUsers
  :<|> servePostUsersUser
  :<|> serveGetUsersUser
  :<|> servePostUsersSend
  :<|> servePostUsersContract
  :<|> servePostUsersUploadList
  :<|> servePostUsersContractMethod
  :<|> servePostUsersSendList
  :<|> servePostUsersContractMethodList
  :<|> serveGetAddresses
  :<|> serveGetAddressesPending
  :<|> serveGetAddressesPendingRemove
  :<|> serveGetContracts
  :<|> serveGetContractsData
  :<|> serveGetContractsContract
  :<|> serveGetContractsState
  :<|> serveGetContractsFunctions
  :<|> serveGetContractsSymbols
  :<|> serveGetContractsStateMapping
  :<|> serveGetContractsStates
  :<|> servePostContractsCompile
  :<|> serveGetSearchContract
  :<|> serveGetSearchContractState
  :<|> serveGetSearchContractStateReduced
  where
    serveGetUsers = undefined
    servePostUsersUser = undefined
    serveGetUsersUser = undefined
    servePostUsersSend = undefined
    servePostUsersContract = undefined
    servePostUsersUploadList = undefined
    servePostUsersContractMethod = undefined
    servePostUsersSendList = undefined
    servePostUsersContractMethodList = undefined
    serveGetAddresses = undefined
    serveGetAddressesPending = undefined
    serveGetAddressesPendingRemove = undefined
    serveGetContracts = undefined
    serveGetContractsData = undefined
    serveGetContractsContract = undefined
    serveGetContractsState = undefined
    serveGetContractsFunctions = undefined
    serveGetContractsSymbols = undefined
    serveGetContractsStateMapping = undefined
    serveGetContractsStates = undefined
    servePostContractsCompile = undefined
    serveGetSearchContract = undefined
    serveGetSearchContractState = undefined
    serveGetSearchContractStateReduced = undefined
