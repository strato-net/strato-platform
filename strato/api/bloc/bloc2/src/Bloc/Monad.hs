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
    blocVaultWrapper,
    blocVaultWrapperWithUserToken,
    BlocEnv (..),
  )
where

import BlockApps.Logging
import Control.Monad.Change.Modify hiding (modify)
import Control.Monad.Composable.Vault
import Control.Monad.Reader
import qualified Database.Redis as Redis
import Data.Text (Text)
import GHC.Stack
import SQLM
import Servant.Client (ClientM)
import Strato.Auth.Client (runWithAuth, runWithUserToken)
import UnliftIO hiding (Handler (..))

data Should a = Don't a | Do a

data Compile = Compile

data CacheNonce = CacheNonce

type HasBlocEnv m = Accessible BlocEnv m

data BlocEnv = BlocEnv
  { stateFetchLimit :: Integer,
    txSizeLimit :: Int,
    gasLimit :: Integer,
    -- | Edge Redis holding the per-address nonce counters shared by every
    -- API instance (see "Bloc.NonceStore"), and how long a counter lives.
    nonceStore :: Redis.Connection,
    nonceTtlSeconds :: Int,
    -- | Base URL of the node's ethereum-jsonrpc service, used for sandboxed
    -- transaction simulation (same container). From ethconf.yaml vmConfig.
    vmJsonRpcUrl :: String,
    -- | Count of in-flight simulations and the ceiling above which new ones are
    -- shed (503), so simulations can't starve block processing on the shared VM.
    simInFlight :: TVar Int,
    simMaxConcurrent :: Int
  }

--------------------------------------------------------------------------------

blocVaultWrapper ::
  (MonadIO m, MonadLogger m, Accessible VaultData m, HasCallStack) =>
  ClientM x ->
  m x
blocVaultWrapper client' = do
  logInfoCS callStack "Querying Vault"
  env <- access Proxy
  resultEither <- liftIO $ runWithAuth env client'
  either (blocError . VaultWrapperError) return resultEither

blocVaultWrapperWithUserToken ::
  (MonadIO m, MonadLogger m, Accessible VaultData m, HasCallStack) =>
  Text ->
  ClientM x ->
  m x
blocVaultWrapperWithUserToken userToken client' = do
  logInfoCS callStack "Querying Vault with user token"
  env <- access Proxy
  resultEither <- liftIO $ runWithUserToken env userToken client'
  either (blocError . VaultWrapperError) return resultEither

blocMaybe :: MonadIO m => Text -> Maybe x -> m x
blocMaybe msg = maybe (throwIO (CouldNotFind msg)) return

getBlocEnv :: HasBlocEnv m => m BlocEnv
getBlocEnv = access Proxy
