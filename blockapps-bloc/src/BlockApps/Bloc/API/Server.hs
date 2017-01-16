{-# LANGUAGE
    OverloadedStrings
  , TypeApplications
#-}

module BlockApps.Bloc.API.Server where

import Data.Acid
import Data.Acid.Advanced
import Servant

import BlockApps.Bloc.API
import BlockApps.Bloc.Store

blocApplication :: AcidState Store -> Application
blocApplication = serve (Proxy @ API) . blocServer

blocServer :: AcidState Store -> Server API
blocServer state =
    getUsers
    :<|> postUser
    :<|> getUserAddresses
    :<|> postSend
    :<|> getContracts
    :<|> getContractData
    :<|> postContract
    -- :<|> getContract
    -- :<|> getContractState
    :<|> postContractMethod
    :<|> getAddresses
    where
      getUsers = query' state UsersQuery
      postUser = undefined
      getUserAddresses = undefined
      postSend = undefined
      getContracts = undefined
      getContractData = undefined
      postContract = undefined
      -- getContract = undefined
      -- getContractState = undefined
      postContractMethod = undefined
      getAddresses = undefined
