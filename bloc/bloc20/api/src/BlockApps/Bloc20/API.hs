{-# OPTIONS_GHC -fno-warn-unused-binds #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators    #-}

module BlockApps.Bloc20.API
  ( BlocAPI
  , markdownBloc
  , layoutBloc
  , mockBloc
  , blocApi
  , module BlockApps.Bloc20.API.Users
  , module BlockApps.Bloc20.API.Addresses
  , module BlockApps.Bloc20.API.Contracts
  , module BlockApps.Bloc20.API.Search
  , module BlockApps.Bloc20.API.Utils
  , module BlockApps.Bloc20.Crypto
  ) where

import           Data.Proxy
import           Data.Text
import           Servant
import           Servant.Docs
import           Servant.Mock

import           BlockApps.Bloc20.API.Addresses
import           BlockApps.Bloc20.API.Contracts
import           BlockApps.Bloc20.API.Search
import           BlockApps.Bloc20.API.Users
import           BlockApps.Bloc20.API.Utils
import           BlockApps.Bloc20.Crypto

type BlocAPI =
  -- / endpoint, for smoke test
  GetHomepage
  -- /users endpoints
  :<|> GetUsers
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
markdownBloc = markdown $ docs blocApi

layoutBloc :: Text
layoutBloc = layout blocApi

mockBloc :: Server BlocAPI
mockBloc = mock blocApi Proxy

blocApi :: Proxy BlocAPI
blocApi = Proxy
