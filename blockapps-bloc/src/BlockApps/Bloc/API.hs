{-# LANGUAGE
    TypeApplications
  , TypeOperators
#-}

module BlockApps.Bloc.API
  ( BlocAPI
  , blocDocs
  , blocMarkdown
  , module Address
  , module Contracts
  , module Search
  , module Users
  , module Utils
  ) where

import BlockApps.Bloc.API.Address as Address
import BlockApps.Bloc.API.Contracts as Contracts
import BlockApps.Bloc.API.Search as Search
import BlockApps.Bloc.API.Users as Users
import BlockApps.Bloc.API.Utils as Utils

import Data.Proxy
import Servant.API
import Servant.Docs

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

blocDocs :: API
blocDocs = docs (Proxy @ BlocAPI)

blocMarkdown :: String
blocMarkdown = markdown blocDocs
