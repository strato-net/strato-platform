{-# OPTIONS_GHC -fno-warn-unused-binds #-}
{-# LANGUAGE TypeOperators    #-}

module BlockApps.Bloc21.API
  ( BlocAPI
  , markdownBloc
  , layoutBloc
  , mockBloc
  , blocApi
  , module BlockApps.Bloc21.API.Users
  , module BlockApps.Bloc21.API.Addresses
  , module BlockApps.Bloc21.API.Contracts
  , module BlockApps.Bloc21.API.Search
  , module BlockApps.Bloc21.API.Utils
  , module BlockApps.Bloc21.Crypto
  ) where

import           Data.Proxy
import           Data.Text
import           Servant
import           Servant.Docs
import           Servant.Mock

import           BlockApps.Bloc21.API.Addresses
import           BlockApps.Bloc21.API.Contracts
import           BlockApps.Bloc21.API.Search
import           BlockApps.Bloc21.API.Users
import           BlockApps.Bloc21.API.Utils
import           BlockApps.Bloc21.Crypto

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
