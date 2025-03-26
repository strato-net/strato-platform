{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}

module Bloc.Server where

import Bloc.API
import Bloc.Monad
import Bloc.Server.Contracts
import Bloc.Server.Transaction
import Bloc.Server.TransactionResult
import Blockchain.DB.CodeDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.Block
import Blockchain.Data.CirrusDefs
import Blockchain.Data.DataDefs
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Keccak256
import Control.Lens (makeLenses, over, (&), (.~), (?~))
import Control.Monad.Change.Alter
import Control.Monad.Composable.Vault
import Control.Monad.Logger
import Data.HashMap.Strict.InsOrd
import Data.Source.Map
import Data.Swagger
import Handlers.AccountInfo
import Handlers.Block
import Handlers.Storage
import Handlers.Transaction
import Servant
import Servant.Swagger
import SolidVM.Model.CodeCollection.Contract
import UnliftIO

type MonadBlocAPI m = 
  ( MonadUnliftIO m,
    MonadLogger m,
    HasBlocEnv m,
    HasVault m,
    Selectable AccountsFilterParams [AddressStateRef] m,
    Selectable Address Contract m,
    Selectable Address AddressState m,
    Selectable Address Certificate m,
    Selectable BlocksFilterParams [Block] m,
    Selectable Keccak256 [TransactionResult] m,
    Selectable StorageFilterParams [StorageAddress] m,
    Selectable TxsFilterParams [RawTransaction] m,
    HasCodeDB m,
    (Keccak256 `Selectable` SourceMap) m
  )

bloc :: MonadBlocAPI m => ServerT BlocAPI m
bloc =
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
    :<|> postBlocTransactionParallel
    :<|> postBlocTransactionBody
    :<|> postBlocTransactionUnsigned
    :<|> postBlocTransaction
    :<|> postBlocTransactionParallelExternal

blocSwagger :: Swagger
blocSwagger =
  toSwagger (Proxy @BlocAPI)
    & info . title .~ "Bloc API"
    & info . version .~ "2.2"
    & info . description ?~ "This is the V2.2 API for the BlocH"
    & basePath ?~ "/bloc/v2.2"

type BlocDocsAPI = "swagger.json" :> Get '[JSON] Swagger

makeLenses ''Swagger

filterEnterprisePaths :: Swagger -> Swagger
filterEnterprisePaths = over swaggerPaths $ filterWithKey (\k _ -> k /= "/users")
