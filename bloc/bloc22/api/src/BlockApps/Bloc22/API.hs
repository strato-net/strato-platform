{-# OPTIONS_GHC -fno-warn-unused-binds #-}
{-# LANGUAGE TypeOperators    #-}

module BlockApps.Bloc22.API
  ( BlocAPI
  , markdownBloc
  , layoutBloc
  , mockBloc
  , blocApi
  , module BlockApps.Bloc22.API.Git
  , module BlockApps.Bloc22.API.Users
  , module BlockApps.Bloc22.API.Addresses
  , module BlockApps.Bloc22.API.Contracts
  , module BlockApps.Bloc22.API.Search
  , module BlockApps.Bloc22.API.Utils
  , module BlockApps.Bloc22.Crypto
  ) where

import           Data.Proxy
import           Data.Text
import           Servant
import           Servant.Docs
import           Servant.Mock

import           BlockApps.Bloc22.API.Addresses
import           BlockApps.Bloc22.API.Contracts
import           BlockApps.Bloc22.API.Git
import           BlockApps.Bloc22.API.Search
import           BlockApps.Bloc22.API.Users
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Crypto

type BlocAPI =
  -- / endpoint, for smoke test
  GetHomepage
  -- /users endpoints
  :<|> GetUsers
  :<|> PostUsersUser
  :<|> GetUsersUser
  :<|> PostUsersFill
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
  :<|> GetContractsEnum
  :<|> PostContractsCompile
  -- /search endpoints
  :<|> GetSearchContract
  :<|> GetSearchContractState
  :<|> GetSearchContractStateReduced
  :<|> GetBlocTransactionResult

markdownBloc :: String
markdownBloc = markdown $ docs blocApi

layoutBloc :: Text
layoutBloc = layout blocApi

mockBloc :: Server BlocAPI
mockBloc = mock blocApi Proxy

blocApi :: Proxy BlocAPI
blocApi = Proxy
