{-# LANGUAGE TypeOperators    #-}

module BlockApps.Bloc22.API
  ( BlocAPI
  , markdownBloc
  , layoutBloc
  , mockBloc
  , blocApi
  , module BlockApps.Bloc22.API.Git
  , module BlockApps.Bloc22.API.Users
  , module BlockApps.Bloc22.API.Contracts
  , module BlockApps.Bloc22.API.Utils
  , module BlockApps.Bloc22.Crypto
  ) where

import           Data.Proxy
import           Data.Text
import           Servant
import           Servant.Docs
import           Servant.Mock

import           BlockApps.Bloc22.API.Chain
import           BlockApps.Bloc22.API.Contracts
import           BlockApps.Bloc22.API.Git
--import           BlockApps.Bloc22.API.Transaction
import           BlockApps.Bloc22.API.Users
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Crypto

type BlocAPI =
  -- / endpoint, for smoke test. Also exports git details.
  GetGitInfo
  -- /users endpoints
--  :<|> PostUsersFill
  -- /contracts endpoints
--  :<|> GetContracts
--  :<|> PostContractsBatchStates
--  :<|> GetContractsData
--  :<|> GetContractsContract
--  :<|> GetContractsState
--  :<|> GetContractsDetails
--  :<|> GetContractsFunctions
--  :<|> GetContractsSymbols
--  :<|> GetContractsStateMapping
--  :<|> GetContractsStates
--  :<|> GetContractsEnum
--  :<|> PostContractsCompile
--  :<|> PostContractsXabi
  -- /search endpoints
--  :<|> GetBlocTransactionResult
--  :<|> PostBlocTransactionResults
  -- /chain endpoints
--  :<|> PostChainInfo
  :<|> GetChainInfo
  -- /chains endpoints
  :<|> PostChainInfos
  -- /transaction endpoints
--  :<|> PostBlocTransactionParallel
--  :<|> PostBlocTransaction

markdownBloc :: String
markdownBloc = markdown $ docs blocApi

layoutBloc :: Text
layoutBloc = layout blocApi

mockBloc :: Server BlocAPI
mockBloc = mock blocApi Proxy

blocApi :: Proxy BlocAPI
blocApi = Proxy
