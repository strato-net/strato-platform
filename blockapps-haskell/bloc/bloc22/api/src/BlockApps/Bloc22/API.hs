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
import           BlockApps.Bloc22.API.Chain
import           BlockApps.Bloc22.API.Contracts
import           BlockApps.Bloc22.API.Git
import           BlockApps.Bloc22.API.Search
import           BlockApps.Bloc22.API.Transaction
import           BlockApps.Bloc22.API.Users
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Crypto

type BlocAPI =
  -- / endpoint, for smoke test. Also exports git details.
  GetGitInfo
  -- /users endpoints
  :<|> GetUsers
  :<|> PostUsersUser
  :<|> GetUsersUser
  :<|> GetUsersKeyStore
  :<|> PostUsersKeyStore
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
  :<|> PostContractsBatchStates
  :<|> GetContractsData
  :<|> GetContractsContract
  :<|> GetContractsState
  :<|> GetContractsDetails
  :<|> GetContractsFunctions
  :<|> GetContractsSymbols
  :<|> GetContractsStateMapping
  :<|> GetContractsStates
  :<|> GetContractsEnum
  :<|> PostContractsCompile
  :<|> PostContractsXabi
  -- /search endpoints
  :<|> GetSearchContract
  :<|> GetBlocTransactionResult
  :<|> PostBlocTransactionResults
  -- /chain endpoints
  :<|> PostChainInfo
  :<|> GetChainInfo
  -- /chains endpoints
  :<|> PostChainInfos
  -- /transaction endpoints
  :<|> PostBlocTransaction

markdownBloc :: String
markdownBloc = markdown $ docs blocApi

layoutBloc :: Text
layoutBloc = layout blocApi

mockBloc :: Server BlocAPI
mockBloc = mock blocApi Proxy

blocApi :: Proxy BlocAPI
blocApi = Proxy
