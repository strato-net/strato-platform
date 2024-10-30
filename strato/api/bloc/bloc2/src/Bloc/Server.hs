{-# LANGUAGE AllowAmbiguousTypes #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}

module Bloc.Server where

import API.Parametric
import Bloc.API
import Bloc.Monad
import Bloc.Server.Contracts
import Bloc.Server.Transaction
import Bloc.Server.TransactionResult
import Blockchain.DB.CodeDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.CirrusDefs
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Keccak256
import Control.Lens (makeLenses, over)
import Control.Monad.Change.Alter
import Control.Monad.Composable.Strato
import Control.Monad.Composable.Vault
import Control.Monad.Logger
import Data.HashMap.Strict.InsOrd
import Data.Source.Map
import Data.Swagger
import GHC.Stack
import Servant
import SolidVM.Model.CodeCollection.Contract
import UnliftIO

blocOauth ::
  ( MonadUnliftIO m,
    MonadLogger m,
    HasBlocEnv m,
    HasVault m,
    HasStrato m,
    HasCallStack,
    Selectable Account Contract m,
    Selectable Account AddressState m,
    Selectable Address Certificate m,
    HasCodeDB m,
    (Keccak256 `Selectable` SourceMap) m
  ) =>
  Proxy InternalHeaders -> ServerT (BlocAPI '[Required, Strict] InternalHeaders) m
blocOauth p =
  return gitInfo
    :<|> getContracts
    :<|> postContractsBatchStates
    :<|> getContractsData
    :<|> getContractsContract
    :<|> getContractsState
    :<|> getContractsDetails
    :<|> getContractsFunctions
    :<|> getContractsSymbols
    :<|> getContractsStateMapping
    :<|> getContractsStates
    :<|> getContractsEnum
    :<|> postContractsCompile
    :<|> postContractsXabi
    :<|> getBlocTransactionResult
    :<|> postBlocTransactionResults
    :<|> embedServer p postBlocTransactionParallel
    :<|> embedServer p postBlocTransactionBody
    :<|> embedServer p postBlocTransactionUnsigned
    :<|> embedServer p postBlocTransaction

blocSimple ::
  ( MonadUnliftIO m,
    MonadLogger m,
    HasBlocEnv m,
    HasVault m,
    HasStrato m,
    HasCallStack,
    Selectable Account Contract m,
    Selectable Account AddressState m,
    Selectable Address Certificate m,
    HasCodeDB m,
    (Keccak256 `Selectable` SourceMap) m
  ) =>
  Proxy ('[] :: [Symbol]) -> ServerT (BlocAPI '[Required, Strict] '[]) m
blocSimple p =
  return gitInfo
    :<|> getContracts
    :<|> postContractsBatchStates
    :<|> getContractsData
    :<|> getContractsContract
    :<|> getContractsState
    :<|> getContractsDetails
    :<|> getContractsFunctions
    :<|> getContractsSymbols
    :<|> getContractsStateMapping
    :<|> getContractsStates
    :<|> getContractsEnum
    :<|> postContractsCompile
    :<|> postContractsXabi
    :<|> getBlocTransactionResult
    :<|> postBlocTransactionResults
    :<|> embedServer p postBlocTransactionParallel
    :<|> embedServer p postBlocTransactionBody
    :<|> embedServer p postBlocTransactionUnsigned
    :<|> embedServer p postBlocTransaction

type BlocDocsAPI = "swagger.json" :> Get '[JSON] Swagger

makeLenses ''Swagger

filterEnterprisePaths :: Swagger -> Swagger
filterEnterprisePaths = over swaggerPaths $ filterWithKey (\k _ -> k /= "/users")
