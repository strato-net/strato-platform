{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Bloc.API
  ( BlocAPI,
    markdownBloc,
    layoutBloc,
    --  , mockBloc
    blocApi,
    module Bloc.API.Git,
    module Bloc.API.Users,
    module Bloc.API.X509,
    module Bloc.API.Contracts,
    module Bloc.API.Chain,
    module Bloc.API.Transaction,
    module Bloc.API.Utils,
  )
where

import Bloc.API.Chain
import Bloc.API.Contracts
import Bloc.API.Git
import Bloc.API.Transaction
import Bloc.API.Users
import Bloc.API.Utils
import Bloc.API.X509
import Data.Proxy
import Data.Text
import Servant
import Servant.Docs

type BlocAPI =
  -- / endpoint, for smoke test. Also exports git details.
  GetGitInfo
    -- /users endpoints
    :<|> PostUsersFill
    -- /x509 endpoints
    :<|> CreateCertificate
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
    -- /chain endpoints
    :<|> PostChainInfo
    :<|> GetSingleChainInfo
    -- /chains endpoints
    :<|> PostChainInfos
    :<|> GetChainInfo
    -- /transaction endpoints
    :<|> PostBlocTransactionParallel
    :<|> PostBlocTransactionRaw
    :<|> PostBlocTransactionBody
    :<|> PostBlocTransactionUnsigned
    :<|> PostBlocTransaction
    :<|> PostBlocTransactionExternal

--Unsure what this will break if anything but remove later
instance ToSample Text where
  toSamples _ = [("sample", "sample")]

markdownBloc :: String
markdownBloc = markdown $ docs blocApi

layoutBloc :: Text
layoutBloc = layout blocApi

--mockBloc :: Server BlocAPI
--mockBloc = mock blocApi (Proxy::Proxy [Int])

blocApi :: Proxy BlocAPI
blocApi = Proxy
