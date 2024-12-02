{-# LANGUAGE DataKinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Bloc.API
  ( BlocAPI,
    markdownBloc,
    layoutBloc,
    blocApi,
    module Bloc.API.Git,
    module Bloc.API.Users,
    module Bloc.API.Contracts,
    module Bloc.API.Transaction,
    module Bloc.API.Utils,
  )
where

import API.Parametric
import Bloc.API.Contracts
import Bloc.API.Git
import Bloc.API.Transaction
import Bloc.API.Users
import Bloc.API.Utils
import Data.Text
import Servant
import Servant.Docs

type BlocAPI r hs =
  -- / endpoint, for smoke test. Also exports git details.
  GetGitInfo
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
    :<|> GetBlocTransactionResult
    :<|> PostBlocTransactionResults
    -- /transaction endpoints
    :<|> PostBlocTransactionParallel r hs
    :<|> PostBlocTransactionBody r hs
    :<|> PostBlocTransactionUnsigned r hs
    :<|> PostBlocTransaction r hs

--Unsure what this will break if anything but remove later
instance ToSample Text where
  toSamples _ = [("sample", "sample")]

markdownBloc :: String
markdownBloc = markdown $ docs blocApi

layoutBloc :: Text
layoutBloc = layout blocApi

blocApi :: Proxy (BlocAPI '[Optional, Strict] ExternalHeaders)
blocApi = Proxy
