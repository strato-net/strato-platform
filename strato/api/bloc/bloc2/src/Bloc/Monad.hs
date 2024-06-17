{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE ImplicitParams #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeSynonymInstances #-}

-- {-# OPTIONS -fno-warn-unused-top-binds #-}

module Bloc.Monad
  ( Should (..),
    Compile (..),
    CacheNonce (..),
    HasBlocEnv,
    blocMaybe,
    getBlocEnv,
    blocStrato,
    blocVaultWrapper,
    BlocEnv (..),
  )
where

import API.Parametric
import Bloc.API.Transaction
import BlockApps.Logging
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainId
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Nonce
import Control.Monad.Change.Modify hiding (modify)
import Control.Monad.Composable.Strato hiding (httpManager)
import Control.Monad.Composable.Vault hiding (httpManager)
import Control.Monad.Reader
import Data.Cache
import Data.Text (Text)
import GHC.Stack
import SQLM
import Servant.Client
import UnliftIO hiding (Handler (..))

data Should a = Don't a | Do a

data Compile = Compile

data CacheNonce = CacheNonce

type HasBlocEnv m = Accessible BlocEnv m

data BlocEnv = BlocEnv
  { stateFetchLimit :: Integer,
    txSizeLimit :: Int,
    accountNonceLimit :: Integer,
    gasLimit :: Integer,
    globalNonceCounter :: Cache Account Nonce,
    txTBQueue :: TBQueue (HeaderList, Maybe ChainId, Maybe Bool, Bool, PostBlocTransactionRequest),
    userRegistryAddress :: Address,
    userRegistryCodeHash :: Maybe Keccak256,
    useWalletsByDefault :: Bool
  }

--------------------------------------------------------------------------------

blocStrato ::
  (MonadIO m, MonadLogger m, HasStrato m, HasCallStack) =>
  ClientM x ->
  m x
blocStrato client' = do
  logInfoCS callStack "Querying STRATO"
  StratoData url mgr <- access Proxy
  resultEither <-
    liftIO $ runClientM client' (mkClientEnv mgr url)
  either (blocError . StratoError) return resultEither

blocVaultWrapper ::
  (MonadIO m, MonadLogger m, HasVault m, HasCallStack) =>
  ClientM x ->
  m x
blocVaultWrapper client' = do
  logInfoCS callStack "Querying Vault Wrapper"
  VaultData url mgr <- access Proxy
  resultEither <-
    liftIO $ runClientM client' (mkClientEnv mgr url)
  either (blocError . VaultWrapperError) return resultEither

blocMaybe :: MonadIO m => Text -> Maybe x -> m x
blocMaybe msg = maybe (throwIO (CouldNotFind msg)) return

getBlocEnv :: HasBlocEnv m => m BlocEnv
getBlocEnv = access Proxy
